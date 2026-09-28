import { Router } from 'express';
import { AgentModel, CallSession, Campaign, Channel, Conversation, Lead, Message, Task } from '@avakado.ai/schemas';
import { authMiddleware } from '../middleware/auth.js';
import { sendKafkaMessage } from '../utils/kafka.js';
import { normalizePhoneNumber } from '../utils/setup.js';
import { buildComponents } from '../utils/tools.js';
import { campaignCronJobSpec } from '../services/campaignEvents.js';

export const campaignRoutes = Router();

campaignRoutes.get('/', authMiddleware, async (req, res) => {
    try {
        const { business } = req.user;
        const { page = 1, limit = 10, name, status, channelIds, leadIds } = req.query;
        const filter = { business };
        if (name) filter.name = { $regex: name, $options: 'i' };
        if (status) filter.status = status;
        if (channelIds) filter.channel = { $in: channelIds.split(',') };
        if (leadIds) filter.leads = { $in: leadIds.split(',') };
        const campaigns = await Campaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const total = await Campaign.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Campaigns fetched successfully', data: campaigns, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch campaigns', error: error.message });
    }
});

campaignRoutes.get('/:id', authMiddleware, async (req, res) => {
    try {
        const campaign = await Campaign.findOne({ _id: req.params.id, business: req.user.business });
        if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
        res.status(200).json({ success: true, message: 'Campaign fetched successfully', data: campaign });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch campaign', error: error.message });
    }
});

campaignRoutes.post('/', authMiddleware, async (req, res) => {
    let campaign = null;
    try {
        const { business, _id: userId, name: userName } = req.user;
        const { name, channelId, leadIds, config = { retries: 1 }, scheduledAt = new Date(Date.now() + 10 * 60 * 1000) } = req.body;
        if (!name || !channelId || !Array.isArray(leadIds) || leadIds.length === 0) {
            return res.status(400).json({ success: false, message: 'name, channelId, and leadIds are required' });
        }
        const channel = await Channel.findById(channelId, '_id name config provider apiAuthenticator').populate('provider').populate('apiAuthenticator');
        if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
        if (!channel.provider?.name) return res.status(400).json({ success: false, message: 'Channel has no provider' });

        const runAt = new Date(scheduledAt);
        campaign = await Campaign.create({
            name,
            business,
            channel: channelId,
            leads: leadIds,
            config,
            status: 'pending',
            timeLines: { scheduledAt: runAt, startedAt: null, completedAt: null, cancelledAt: null },
            cancel_requested: false,
            createdBy: userId,
        });

        const tasks = [];
        switch (channel.provider.name) {
            case 'Whatsapp': {
                const template = config?.template;
                if (!template?.templateName || !template?.languageCode) {
                    await campaign.deleteOne();
                    campaign = null;
                    return res.status(400).json({ success: false, message: 'templateName and languageCode are required' });
                }
                const { templateName, languageCode, parametersMap = [] } = template;
                for (const leadId of leadIds) {
                    const lead = await Lead.findById(leadId);
                    if (!lead) {
                        await campaign.deleteOne();
                        campaign = null;
                        return res.status(404).json({ success: false, message: 'Lead not found' });
                    }
                    const to = lead.contactDetails?.whatsapp?.find((entry) => entry.isPrimary)?.handle
                        ?? lead.contactDetails?.whatsapp?.[0]?.handle
                        ?? lead.contactDetails?.phone?.[0]?.handle;
                    const components = buildComponents(parametersMap, { lead });
                    let lastConversation = await Conversation.findOne({ lead: leadId, channel: channelId, business });
                    if (!lastConversation) {
                        const agentDetails = await AgentModel.findOne({ channels: channelId });
                        lastConversation = await Conversation.create({
                            lead: leadId,
                            channel: channelId,
                            agent: agentDetails?._id,
                            business,
                            externalConversationId: to,
                        });
                    }
                    const message = await Message.create({
                        conversation: lastConversation?._id,
                        business,
                        campaign: campaign._id,
                        direction: 'outbound',
                        sender: { type: 'user', id: userId, name: userName, ref: userId, refModel: 'Users' },
                        type: 'template',
                        content: { templateName, languageCode, components },
                        statusTimeline: { scheduled: runAt },
                    });
                    tasks.push({
                        lead: leadId,
                        type: 'quick',
                        data: {
                            input: { to, templateName, languageCode, components },
                            config: { phoneNumberId: channel.config?.phone_number_id },
                            apiId: '6a4c109329ef086643c24211',
                            authId: channel.apiAuthenticator,
                        },
                        references: { type: 'Message', id: message?._id },
                    });
                }
                break;
            }
            case 'Exotel': {
                const { exophone, appId } = channel.config ?? {};
                const accountSid = channel.apiAuthenticator?.credentials?.accountSid;
                if (!accountSid || !exophone || !appId) {
                    await campaign.deleteOne();
                    campaign = null;
                    return res.status(400).json({ success: false, message: 'accountSid, exophone, and appId are required' });
                }
                for (const leadId of leadIds) {
                    const lead = await Lead.findById(leadId);
                    if (!lead) {
                        await campaign.deleteOne();
                        campaign = null;
                        return res.status(404).json({ success: false, message: 'Lead not found' });
                    }
                    const completePhoneNumber = lead.contactDetails?.phone?.find((entry) => entry.isPrimary) ?? lead.contactDetails?.phone?.[0];
                    const normalizedPhoneNumber = normalizePhoneNumber(completePhoneNumber?.handle, completePhoneNumber?.metadata?.country ?? 'IN');
                    if (!normalizedPhoneNumber) {
                        await campaign.deleteOne();
                        campaign = null;
                        return res.status(400).json({ success: false, message: `Invalid phone number of leadId: ${leadId}` });
                    }
                    const leadPhoneNumber = normalizedPhoneNumber.nationalNumber;
                    const agentDetails = await AgentModel.findOne({ channels: channelId });
                    let lastConversation = await Conversation.findOne({ lead: leadId, channel: channelId, business });
                    if (!lastConversation) {
                        lastConversation = await Conversation.create({
                            lead: leadId,
                            channel: channelId,
                            agent: agentDetails?._id,
                            business,
                            externalConversationId: leadPhoneNumber,
                        });
                    }
                    const callSession = await CallSession.create({
                        lead: leadId,
                        agent: agentDetails?._id,
                        conversation: lastConversation?._id,
                        campaign: campaign._id,
                        business,
                        channel: channel._id,
                        direction: 'outbound-dial',
                        statusTimeline: { scheduledAt: runAt },
                        callDetails: {
                            session: {
                                model: agentDetails?.modelConfig?.model,
                                sampleRate: 24000,
                                voice: agentDetails?.responseConfig?.audio?.output?.voice || agentDetails?.responseConfig?.realtimeOutputConfig?.voice,
                            },
                        },
                    });
                    tasks.push({
                        lead: leadId,
                        type: 'webhook',
                        data: {
                            input: {
                                From: leadPhoneNumber,
                                CallerId: exophone,
                                Url: `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`,
                                StatusCallback: `https://chat.avakado.ai/webhook/${channel.provider.name}`,
                                Record: true,
                                CustomField: { callSession: callSession._id, campaign: campaign._id, business },
                            },
                            apiId: '6a50b6bf445a2fbf099b4a29',
                            authId: channel.apiAuthenticator._id,
                        },
                        references: { type: 'CallSession', id: callSession?._id },
                    });
                }
                break;
            }
            default: {
                await campaign.deleteOne();
                campaign = null;
                return res.status(400).json({ success: false, message: 'Cannot service campaign for this channel' });
            }
        }

        await Task.insertMany(tasks.map((task) => ({ ...task, campaign: campaign._id, business })));
        await sendKafkaMessage({
            topic: 'cron-job',
            messages: [{ key: 'create', value: JSON.stringify(campaignCronJobSpec(campaign, runAt)) }],
        });
        res.status(200).json({ success: true, message: 'Campaign created successfully', data: campaign });
    } catch (error) {
        console.error(error);
        if (campaign) await campaign.deleteOne().catch(() => { });
        res.status(500).json({ success: false, message: 'Failed to create campaign', error: error.message });
    }
});