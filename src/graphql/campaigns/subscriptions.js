import graphqlFields from 'graphql-fields';
import { GraphQLError } from 'graphql';
import { Campaign, Task, User, Channel, Lead, Message, Conversation, AgentModel, CallSession } from '@avakado.ai/schemas';
import { sendKafkaMessage } from '../../utils/kafka.js';
import { buildComponents } from '../../utils/tools.js';
import { normalizePhoneNumber } from '../../utils/setup.js';
import { campaignCronJobSpec } from '../../services/campaignEvents.js';
import { constructWhatsappMessageFromTemplate } from './helpers.js';
import { sessionMedia } from '../../utils/CallSessions.js';
import { buildDirectMessageTasks, validateDirectMessageCampaign } from '../../utils/messagingChannels.js';
import { assertUser } from '../progress/auth.js';
import { errorText, feed, progressSnapshot } from '../progress/events.js';

const VALIDATE_FIELD = 'validateCampaignProgress';
const CREATE_FIELD = 'createCampaignProgress';

function channelError(message, code) {
  return new GraphQLError(message, { extensions: { code: code || 'BAD_REQUEST' } });
}

async function validateWhatsappLead(leadId, parametersMap) {
  const lead = await Lead.findById(leadId);
  if (!lead) return 'Lead not found';
  const to = lead.contactDetails?.whatsapp?.find((entry) => entry.isPrimary)?.handle
    ?? lead.contactDetails?.whatsapp?.[0]?.handle;
  if (!to) return 'Primary WhatsApp number not found';
  try {
    buildComponents(parametersMap, { lead });
  } catch (error) {
    return `error in building components for leadId: ${leadId} - ${error.message}`;
  }
  return null;
}

async function validateExotelLead(leadId) {
  const lead = await Lead.findById(leadId);
  if (!lead) return 'Lead not found';
  const phone = lead.contactDetails?.phone;
  const completePhoneNumber = phone?.find((entry) => entry.isPrimary) ?? phone?.[0];
  try {
    const normalizedPhoneNumber = normalizePhoneNumber(
      completePhoneNumber?.handle,
      completePhoneNumber?.metadata?.country ?? 'IN'
    );
    if (!normalizedPhoneNumber) return `Invalid phone number of leadId: ${leadId}`;
  } catch (error) {
    return `error in normalizing phone number for leadId: ${leadId} - ${error.message} - ${completePhoneNumber?.handle} - ${completePhoneNumber?.metadata?.country ?? 'IN'}`;
  }
  return null;
}

function assertProviderReady(channel, config, mode) {
  const providerName = channel.provider?.name;
  const known = ['Whatsapp', 'Telegram', 'Instagram', 'Exotel'];
  if (!providerName || !known.includes(providerName)) {
    if (mode === 'create') throw channelError('Cannot service campaign for this channel', 'Invalid_Channel');
    throw channelError('Invalid channel provider', 'INVALID_CHANNEL_PROVIDER');
  }
  if (providerName === 'Whatsapp') {
    if (mode === 'validate') {
      if (!channel.config?.phone_number_id) throw channelError('phone_number_id is required');
      if (!channel.apiAuthenticator) throw channelError('apiAuthenticator is required');
    }
    const { templateName, languageCode } = config.runtime || {};
    if (!templateName || !languageCode) throw channelError('templateName, languageCode are required');
  }
  if (providerName === 'Telegram' || providerName === 'Instagram') {
    if (!config.runtime?.text || !String(config.runtime.text).trim()) throw channelError('runtime.text is required');
  }
  if (providerName === 'Exotel') {
    const { exophone, appId } = channel.config || {};
    const accountSid = channel.apiAuthenticator?.credentials?.accountSid;
    if (!accountSid) throw channelError('accountSid is required in credentials of channel apiAuthenticator');
    if (!exophone || !appId) throw channelError('exophone, appId are required in channel config');
  }
  return providerName;
}

export async function* validateCampaignStream(_, { channelId, leadIds, config = {} }, context) {
  assertUser(context);
  const ids = leadIds || [];
  const total = ids.length;
  const leadErrors = [];
  let processed = 0;

  try {
    yield feed(VALIDATE_FIELD, {
      progress: progressSnapshot({ phase: 'started', processed: 0, total, message: 'Validating campaign' }),
    });

    const channel = await Channel.findById(channelId, '_id name config provider apiAuthenticator')
      .populate('provider')
      .populate('apiAuthenticator');
    if (!channel) throw channelError('Channel not found', 'NOT_FOUND');
    const providerName = assertProviderReady(channel, config, 'validate');

    if (providerName === 'Exotel') {
      const agentDetails = await AgentModel.findOne({ channels: channelId });
      if (!agentDetails) throw channelError('agentDetails is required');
      const model = agentDetails?.modelConfig?.model;
      const voice = agentDetails?.responseConfig?.audio?.output?.voice || agentDetails?.responseConfig?.realtimeOutputConfig?.voice;
      if (!model || !voice) {
        throw channelError('model, voice are required in modelConfig.model or responseConfig.audio.output.voice or responseConfig.realtimeOutputConfig.voice of agentDetails');
      }
    }

    for (const leadId of ids) {
      let leadError = null;
      if (providerName === 'Whatsapp') {
        leadError = await validateWhatsappLead(leadId, config.runtime?.parametersMap);
      } else if (providerName === 'Telegram' || providerName === 'Instagram') {
        const checked = await validateDirectMessageCampaign({
          providerName,
          leadIds: [leadId],
          channelId,
          runtime: config.runtime,
        });
        if (checked.fatal) throw channelError(checked.fatal);
        leadError = checked.leadErrors[0]?.error || null;
      } else {
        leadError = await validateExotelLead(leadId);
      }
      if (leadError) leadErrors.push({ leadId, error: leadError });
      processed += 1;
      yield feed(VALIDATE_FIELD, {
        progress: progressSnapshot({
          phase: 'progress',
          processed,
          total,
          ok: !leadError,
          error: leadError,
          message: leadError || 'Lead is valid',
        }),
        leadId,
        valid: !leadError,
        leadError,
      });
    }

    const valid = leadErrors.length === 0;
    yield feed(VALIDATE_FIELD, {
      progress: progressSnapshot({
        phase: 'completed',
        processed: total,
        total,
        ok: valid,
        code: valid ? null : 'INVALID_LEADS',
        message: valid ? 'All leads are valid' : 'Invalid leads',
      }),
      valid,
      leadErrors,
    });
  } catch (error) {
    console.error('validateCampaignProgress:', errorText(error));
    yield feed(VALIDATE_FIELD, {
      progress: progressSnapshot({
        phase: 'failed',
        processed,
        total,
        ok: false,
        error: errorText(error),
        code: error.extensions?.code || 'BAD_REQUEST',
        message: errorText(error),
      }),
      valid: false,
      leadErrors,
    });
  }
}

async function rollbackCampaign(campaignId) {
  if (!campaignId) return;
  await Promise.all([
    Task.deleteMany({ campaign: campaignId }),
    Message.deleteMany({ campaign: campaignId }),
    CallSession.deleteMany({ campaign: campaignId }),
    Campaign.deleteOne({ _id: campaignId }),
  ]);
}

async function populateCampaign(campaign, info) {
  const requested = graphqlFields(info, {}, { processArguments: false });
  const fields = requested.campaign;
  if (!fields) return campaign;
  if (fields.createdBy) await User.populate(campaign, { path: 'createdBy' });
  if (fields.channel) await Channel.populate(campaign, { path: 'channel' });
  if (fields.leads) await Lead.populate(campaign, { path: 'leads' });
  return campaign;
}

async function whatsappTask({ leadId, channel, channelId, config, user, businessId, scheduledAt, campaignId }) {
  const { template, runtime: { templateName, languageCode, parametersMap } } = config;
  const lead = await Lead.findById(leadId);
  if (!lead) throw channelError('Lead not found', 'NOT_FOUND');
  const data = { lead };
  const to = lead.contactDetails?.whatsapp?.find((entry) => entry.isPrimary)?.handle
    ?? lead.contactDetails?.whatsapp?.[0]?.handle
    ?? lead.contactDetails?.phone?.[0]?.handle;
  const components = buildComponents(parametersMap, data);
  let lastConversation = await Conversation.findOne({ lead: leadId, channel: channelId, business: businessId });
  if (!lastConversation) {
    const agentDetails = await AgentModel.findOne({ channels: channelId });
    lastConversation = await Conversation.create({
      lead: leadId,
      channel: channelId,
      agent: agentDetails?._id,
      business: businessId,
      externalConversationId: to,
    });
  }
  const message = await Message.create({
    conversation: lastConversation?._id,
    business: businessId,
    campaign: campaignId,
    direction: 'outbound',
    sender: {
      type: 'user',
      id: user._id,
      name: user.name,
      ref: user._id,
      refModel: 'Users',
    },
    type: 'template',
    content: constructWhatsappMessageFromTemplate(template, components),
    statusTimeline: { scheduled: scheduledAt },
  });
  return {
    lead: leadId,
    type: 'quick',
    data: {
      input: { to, templateName, languageCode, components },
      config: { phoneNumberId: channel.config.phone_number_id },
      apiId: '6a4c109329ef086643c24211',
      authId: channel.apiAuthenticator,
    },
    references: { type: 'Message', id: message?._id },
  };
}

async function exotelTask({ leadId, channel, channelId, user, businessId, scheduledAt, campaignId }) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw channelError('Lead not found', 'NOT_FOUND');
  const phone = lead.contactDetails?.phone;
  const completePhoneNumber = phone?.find((entry) => entry.isPrimary) ?? phone?.[0];
  let leadPhoneNumber = null;
  try {
    const normalizedPhoneNumber = normalizePhoneNumber(
      completePhoneNumber?.handle,
      completePhoneNumber?.metadata?.country ?? 'IN'
    );
    if (normalizedPhoneNumber) leadPhoneNumber = normalizedPhoneNumber.nationalNumber;
  } catch (error) {
    throw channelError(
      `error in normalizing phone number for leadId: ${leadId} - ${error.message}`,
      'BAD_REQUEST'
    );
  }
  if (!leadPhoneNumber) throw channelError(`Invalid phone number of leadId: ${leadId}`, 'BAD_REQUEST');

  const { accountSid } = channel.apiAuthenticator.credentials;
  const { exophone, appId } = channel.config;
  let lastConversation = await Conversation.findOne({ lead: leadId, channel: channelId, business: businessId });
  const agentDetails = await AgentModel.findOne({ channels: channelId });
  if (!lastConversation) {
    lastConversation = await Conversation.create({
      lead: leadId,
      channel: channelId,
      agent: agentDetails?._id,
      business: businessId,
      externalConversationId: leadPhoneNumber,
    });
  }
  const callSession = await CallSession.create({
    lead: leadId,
    agent: agentDetails?._id,
    conversation: lastConversation?._id,
    campaign: campaignId,
    business: businessId,
    channel: channel._id,
    direction: 'outbound-dial',
    statusTimeline: { scheduledAt },
    callDetails: {
      session: sessionMedia({
        channelName: channel.provider.name,
        channelConfig: channel.config,
        agent: agentDetails,
      }),
    },
  });
  return {
    lead: leadId,
    type: 'webhook',
    data: {
      input: {
        From: leadPhoneNumber,
        CallerId: exophone,
        Url: `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`,
        StatusCallback: `https://chat.avakado.ai/webhook/${channel.provider.name}`,
        Record: true,
        CustomField: {
          callSession: callSession._id,
          campaign: campaignId,
          business: businessId,
        },
      },
      apiId: '6a50b6bf445a2fbf099b4a29',
      authId: channel.apiAuthenticator._id,
    },
    references: { type: 'CallSession', id: callSession?._id },
  };
}

export async function* createCampaignStream(_, { name, channelId, leadIds, config = { retries: 1 }, scheduledAt }, context, info) {
  const user = assertUser(context);
  const ids = leadIds || [];
  const total = ids.length;
  const when = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 10 * 60 * 1000);
  const campaignConfig = config ?? { retries: 1 };
  const tasks = [];
  let processed = 0;
  let campaign = null;
  let committed = false;

  try {
    if (!ids.length) throw channelError('leadIds are required', 'BAD_USER_INPUT');
    const channel = await Channel.findById(channelId, '_id name config provider apiAuthenticator')
      .populate('provider')
      .populate('apiAuthenticator');
    if (!channel) throw channelError('Channel not found', 'NOT_FOUND');
    const providerName = assertProviderReady(channel, campaignConfig, 'create');

    campaign = await Campaign.create({
      name,
      business: user.business,
      channel: channelId,
      leads: ids,
      config: campaignConfig,
      status: 'pending',
      timeLines: { scheduledAt: when, startedAt: null, completedAt: null, cancelledAt: null },
      cancel_requested: false,
      createdBy: user._id,
    });

    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({ phase: 'started', processed: 0, total, message: 'Campaign created' }),
    });

    for (let index = 0; index < ids.length; index += 1) {
      const leadId = ids[index];
      try {
        if (providerName === 'Whatsapp') {
          tasks.push(await whatsappTask({
            leadId,
            channel,
            channelId,
            config: campaignConfig,
            user,
            businessId: user.business,
            scheduledAt: when,
            campaignId: campaign._id,
          }));
        } else if (providerName === 'Telegram' || providerName === 'Instagram') {
          try {
            tasks.push(...await buildDirectMessageTasks({
              providerName,
              leadIds: [leadId],
              channel,
              businessId: user.business,
              user,
              scheduledAt: when,
              runtime: campaignConfig.runtime,
              campaignId: campaign._id,
            }));
          } catch (error) {
            throw channelError(error.message);
          }
        } else {
          tasks.push(await exotelTask({
            leadId,
            channel,
            channelId,
            user,
            businessId: user.business,
            scheduledAt: when,
            campaignId: campaign._id,
          }));
        }
      } catch (error) {
        error.leadId = leadId;
        throw error;
      }
      processed += 1;
      yield feed(CREATE_FIELD, {
        progress: progressSnapshot({
          phase: 'progress',
          processed,
          total,
          index,
          ok: true,
          message: `Prepared ${processed} of ${total}`,
        }),
        leadId,
      });
    }

    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({
        phase: 'progress',
        processed: total,
        total,
        message: 'Scheduling campaign',
      }),
    });

    await Task.insertMany(tasks.map((task) => ({ ...task, campaign: campaign._id, business: user.business })));
    await sendKafkaMessage({
      topic: 'cron-job',
      messages: [{ key: 'create', value: JSON.stringify(campaignCronJobSpec(campaign, when)) }],
    });
    committed = true;
    try {
      await populateCampaign(campaign, info);
    } catch (populateError) {
      console.error('createCampaignProgress populate', populateError);
    }
    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({
        phase: 'completed',
        processed: total,
        total,
        ok: true,
        message: 'Campaign scheduled',
      }),
      campaign,
    });
  } catch (error) {
    console.error('createCampaignProgress:', errorText(error));
    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({
        phase: 'failed',
        processed,
        total,
        index: processed < total ? processed : null,
        ok: false,
        error: errorText(error),
        code: error.extensions?.code || 'BAD_REQUEST',
        message: errorText(error),
      }),
      leadId: error.leadId || null,
      leadError: errorText(error),
    });
  } finally {
    if (!committed && campaign?._id) {
      const campaignId = campaign._id;
      campaign = null;
      try {
        await rollbackCampaign(campaignId);
      } catch (rollbackError) {
        console.error('createCampaignProgress rollback', rollbackError);
      }
    }
  }
}
