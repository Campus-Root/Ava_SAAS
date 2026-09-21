import graphqlFields from "graphql-fields";
import { flattenFields, getSelectFields } from "../../utils/graphqlTools.js";
import { GraphQLError } from "graphql";
import { Campaign, Task } from "@avakado.ai/schemas";
import { Business } from "@avakado.ai/schemas";
import { User } from '@avakado.ai/schemas';
import { Channel } from '@avakado.ai/schemas';
import { sendKafkaMessage } from "../../utils/kafka.js";
import { Lead } from '@avakado.ai/schemas';
import { buildComponents } from "../../utils/tools.js";
import { normalizePhoneNumber } from "../../utils/setup.js";
import { Message } from '@avakado.ai/schemas';
import { Conversation } from "@avakado.ai/schemas";
import { AgentModel } from '@avakado.ai/schemas';
import { CallSession } from '@avakado.ai/schemas';
import { campaignCronJobSpec } from "../../services/campaignEvents.js";
export const jobResolvers = {
    Query: {
        fetchCampaigns: async (_, { id, name, channelIds, leadIds, status, limit = 10, page = 1 }, context, info) => {
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            if (name) filter.name = { $regex: name, $options: "i" };
            if (channelIds) filter.channel = { $in: channelIds };
            if (leadIds) filter.leads = { $in: leadIds };
            if (status) filter.status = status;
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const campaigns = await Campaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(rootFields);
            const totalDocuments = await Campaign.countDocuments(filter);
            if (populateFields?.business) await Business.populate(campaigns, { path: 'business', select: populateFields.business });
            if (populateFields?.leads) await Lead.populate(campaigns, { path: 'leads', select: populateFields.leads });
            if (populateFields?.createdBy) await User.populate(campaigns, { path: 'createdBy', select: populateFields.createdBy });
            if (populateFields?.channel) await Channel.populate(campaigns, { path: 'channel', select: populateFields.channel });
            return { data: campaigns, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        fetchCampaignFacets: async (_, __, context) => {
            const baseFilter = { business: context.user.business };
            const [result] = await Campaign.aggregate([
                { $match: baseFilter },
                {
                    $facet: {
                        status: [
                            { $group: { _id: '$status', count: { $sum: 1 } } },
                            { $match: { _id: { $ne: null } } },
                            { $sort: { count: -1 } },
                        ],
                        channel: [
                            { $group: { _id: '$channel', count: { $sum: 1 } } },
                            { $match: { _id: { $ne: null } } },
                            { $project: { _id: 0, value: { $toString: '$_id name' }, count: 1 } },
                            { $sort: { count: -1 } },
                        ],
                    },
                },
            ]);
            return result;
        },
        fetchTasks: async (_, { campaignId, status, limit = 10, page = 1 }, context, info) => {
            const filter = { business: context.user.business };
            if (campaignId) filter.campaign = campaignId;
            if (status) filter.status = status;
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const tasks = await Task.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(rootFields);
            const totalDocuments = await Task.countDocuments(filter);
            if (populateFields?.business) await Business.populate(tasks, { path: 'business', select: populateFields.business });
            if (populateFields?.campaign) await Campaign.populate(tasks, { path: 'campaign', select: populateFields.campaign });
            if (populateFields?.lead) await Lead.populate(tasks, { path: 'lead', select: populateFields.lead });
            return { data: tasks, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        validateCampaign: async (_, { channelId, leadIds, config = {} }, context, info) => {
            const channel = await Channel.findById(channelId, "_id name config provider apiAuthenticator").populate("provider").populate("apiAuthenticator");
            if (!channel) throw new GraphQLError("Channel not found");
            let leadErrors = [];
            switch (channel.provider.name) {
                case "Whatsapp": {
                    if (!channel.config.phone_number_id) throw new GraphQLError("phone_number_id is required");
                    if (!channel.apiAuthenticator) throw new GraphQLError("apiAuthenticator is required");
                    const { template: { templateName, languageCode, parametersMap = [] } } = config;
                    if (!templateName || !languageCode) throw new GraphQLError("templateName, languageCode are required");
                    // stack all lead errors and return them in a single array
                    for (const leadId of leadIds) {
                        let lead = await Lead.findById(leadId);
                        if (!lead) {
                            leadErrors.push({ leadId, error: "Lead not found" });
                            continue;
                        }
                        const data = { lead }
                        let to = lead.contactDetails.whatsapp?.find(entry => entry.isPrimary)?.handle ?? lead.contactDetails.whatsapp?.[0]?.handle;
                        if (!to) {
                            leadErrors.push({ leadId, error: "Primary WhatsApp number not found" });
                            continue;
                        }
                        let components = null;
                        try {
                            components = buildComponents(parametersMap, data);
                        } catch (error) {
                            leadErrors.push({ leadId, error: `error in building components for leadId: ${leadId} - ${error.message}` });
                            continue;
                        }
                    }
                    break;
                }
                case "Exotel": {
                    const { exophone, appId } = channel.config;
                    const { accountSid } = channel.apiAuthenticator.credentials;
                    if (!accountSid) throw new GraphQLError("accountSid is required in credentials of channel apiAuthenticator");
                    if (!exophone || !appId) throw new GraphQLError("exophone, appId are required in channel config");
                    const agentDetails = await AgentModel.findOne({ channels: channelId })
                    if (!agentDetails) throw new GraphQLError("agentDetails is required");
                    const model = agentDetails?.modelConfig?.model;
                    const voice = agentDetails?.responseConfig?.audio?.output?.voice || agentDetails?.responseConfig.realtimeOutputConfig?.voice;
                    if (!model || !voice) throw new GraphQLError("model, voice are required in modelConfig.model or responseConfig.audio.output.voice or responseConfig.realtimeOutputConfig.voice of agentDetails");
                    for (const leadId of leadIds) {
                        let lead = await Lead.findById(leadId);
                        if (!lead) {
                            leadErrors.push({ leadId, error: "Lead not found" });
                            continue;
                        }
                        let leadPhoneNumber = null;
                        const { phone } = lead.contactDetails;
                        const completePhoneNumber = phone?.find(entry => entry.isPrimary) ?? phone?.[0];
                        let normalizedPhoneNumber = null;
                        try {
                            normalizedPhoneNumber = normalizePhoneNumber(completePhoneNumber?.handle, completePhoneNumber?.metadata?.country ?? 'IN');
                        } catch (error) {
                            leadErrors.push({ leadId, error: `error in normalizing phone number for leadId: ${leadId} - ${error.message} - ${completePhoneNumber?.handle} - ${completePhoneNumber?.metadata?.country ?? 'IN'}` });
                            continue;
                        }
                        if (normalizedPhoneNumber) leadPhoneNumber = normalizedPhoneNumber.nationalNumber;
                        else {
                            leadErrors.push({ leadId, error: "Invalid phone number of leadId: " + leadId });
                            continue;
                        }

                    }
                    break;
                }
                default:
                    throw new GraphQLError("Invalid channel provider", { extensions: { code: "INVALID_CHANNEL_PROVIDER" } });
            }
            if (leadErrors.length > 0) throw new GraphQLError("Invalid leads", { extensions: { code: "INVALID_LEADS", leadErrors } });
            return true;
        }
    },
    Mutation: {
        createCampaign: async (_, { name, channelId, leadIds, config = { retries: 1 }, scheduledAt = new Date(Date.now() + 10 * 60 * 1000) }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const channel = await Channel.findById(channelId, "_id name config provider apiAuthenticator").populate("provider").populate("apiAuthenticator");
            if (!channel) throw new GraphQLError("Channel not found");
            const tasks = [];
            const newCampaign = await Campaign.create({ name, business: context.user.business, channel: channelId, leads: leadIds, config, status: "pending", timeLines: { scheduledAt: new Date(scheduledAt), startedAt: null, completedAt: null, cancelledAt: null }, cancel_requested: false, createdBy: context.user._id, });
            switch (channel.provider.name) {
                case "Whatsapp": {
                    const { template: { templateName, languageCode, parametersMap = [] } } = config;
                    if (!templateName || !languageCode) {
                        await newCampaign.deleteOne();
                        throw new GraphQLError("templateName, languageCode are required");
                    }
                    for (const leadId of leadIds) {
                        let lead = await Lead.findById(leadId);
                        if (!lead) {
                            await newCampaign.deleteOne();
                            throw new GraphQLError("Lead not found");
                        }
                        const data = { lead }
                        let to = lead.contactDetails.whatsapp?.find(entry => entry.isPrimary)?.handle ?? lead.contactDetails.whatsapp?.[0]?.handle ?? lead.contactDetails.phone?.[0]?.handle;
                        const components = buildComponents(parametersMap, data);
                        let lastConversation = await Conversation.findOne({ lead: leadId, channel: channelId, business: context.user.business });
                        if (!lastConversation) {
                            const agentDetails = await AgentModel.findOne({ channels: channelId })
                            lastConversation = await Conversation.create({ lead: leadId, channel: channelId, agent: agentDetails?._id, business: context.user.business, externalConversationId: to });
                        }
                        const message = await Message.create({
                            conversation: lastConversation?._id,
                            business: context.user.business,
                            campaign: newCampaign._id,
                            direction: "outbound",
                            sender: {
                                type: "user",
                                id: context.user._id,
                                name: context.user.name,
                                ref: context.user._id,
                                refModel: "Users"
                            },
                            type: "template",
                            content: {
                                templateName,
                                languageCode,
                                components: components
                            },
                            statusTimeline: { scheduled: scheduledAt }
                        })
                        tasks.push({
                            lead: leadId,
                            type: "quick",
                            data: {
                                input: {
                                    "to": to,
                                    templateName,
                                    languageCode,
                                    components: components
                                },
                                config: { phoneNumberId: channel.config.phone_number_id },
                                apiId: "6a4c109329ef086643c24211",
                                authId: channel.apiAuthenticator
                            },
                            references: { type: "Message", id: message?._id }
                        });
                    }
                    break;
                }
                case "Exotel": {
                    for (const leadId of leadIds) {
                        let lead = await Lead.findById(leadId);
                        let leadPhoneNumber = null;
                        const { phone } = lead.contactDetails;
                        const completePhoneNumber = phone?.find(entry => entry.isPrimary) ?? phone?.[0];
                        const normalizedPhoneNumber = normalizePhoneNumber(completePhoneNumber?.handle, completePhoneNumber?.metadata?.country ?? 'IN');
                        if (normalizedPhoneNumber) leadPhoneNumber = normalizedPhoneNumber.nationalNumber;
                        else {
                            await newCampaign.deleteOne();
                            throw new GraphQLError("Invalid phone number of leadId: " + leadId, { extensions: { code: "BAD_REQUEST" } })
                        }
                        const { accountSid } = channel.apiAuthenticator.credentials;
                        const { exophone, appId } = channel.config;
                        let lastConversation = await Conversation.findOne({ lead: leadId, channel: channelId, business: context.user.business });
                        const agentDetails = await AgentModel.findOne({ channels: channelId })
                        if (!lastConversation) {
                            lastConversation = await Conversation.create({ lead: leadId, channel: channelId, agent: agentDetails?._id, business: context.user.business, externalConversationId: leadPhoneNumber });
                        }
                        const callSession = await CallSession.create({
                            lead: leadId,
                            agent: agentDetails?._id,
                            conversation: lastConversation?._id,
                            campaign: newCampaign._id,
                            business: context.user.business,
                            channel: channel._id,
                            direction: "outbound-dial",
                            statusTimeline: { scheduledAt: scheduledAt },
                            callDetails: {
                                session: {
                                    model: agentDetails?.modelConfig?.model,
                                    sampleRate: 24000,
                                    voice: agentDetails?.responseConfig?.audio?.output?.voice || agentDetails?.responseConfig.realtimeOutputConfig?.voice,
                                }
                            },
                        });
                        tasks.push({
                            lead: leadId,
                            type: "webhook",
                            data: {
                                input: {
                                    From: leadPhoneNumber,
                                    CallerId: exophone,
                                    Url: `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`,
                                    StatusCallback: `https://chat.avakado.ai/webhook/${channel.provider.name}`,
                                    Record: true,
                                    CustomField: {
                                        callSession: callSession._id,
                                        campaign: newCampaign._id,
                                        business: context.user.business
                                    }
                                },
                                apiId: "6a50b6bf445a2fbf099b4a29",
                                authId: channel.apiAuthenticator._id,
                            },
                            references: { type: "CallSession", id: callSession?._id }
                        });
                    }
                    break;
                }
                default:
                    throw new GraphQLError("Cannot service campaign for this channel", { extensions: { code: "Invalid_Channel" } });
            }
            await Task.insertMany(tasks.map(task => ({ ...task, campaign: newCampaign._id, business: context.user.business })));
            await sendKafkaMessage({
                topic: 'cron-job', messages: [{
                    key: "create",
                    value: JSON.stringify(campaignCronJobSpec(newCampaign, scheduledAt))
                }]
            });
            await User.populate(newCampaign, { path: 'createdBy', select: nested.createdBy });
            await Channel.populate(newCampaign, { path: 'channel', select: nested.channel });
            return newCampaign;
        },
        cancelCampaign: async (_, { id }, context, info) => {
            const campaign = await Campaign.findByIdAndUpdate(id, { cancel_requested: true }, { new: true });
            if (!campaign) throw new GraphQLError("Campaign not found");
            return campaign;
        }
    }
}
