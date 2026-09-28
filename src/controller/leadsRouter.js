import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth.js';
import { AgentModel, CallSession, Channel, Conversation, Lead, Message, Providers } from '@avakado.ai/schemas';
import { sendKafkaMessage } from '../utils/kafka.js';
import { documentTypes } from '../utils/graphqlTools.js';
import { normalizePhoneNumber } from '../utils/setup.js';
import { uploadFileToWhatsApp } from '../utils/whatsapp-app-bootstrap.js';

const contactUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1000 * 1000 },
}).single('file');

function acceptContactBody(req, res, next) {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return next();
    contactUpload(req, res, (err) => {
        if (!err) return next();
        const message = err instanceof multer.MulterError ? err.message : 'Failed to read upload';
        return res.status(400).json({ success: false, message });
    });
}

function primaryEntry(entries) {
    return entries?.find((entry) => entry.isPrimary) ?? entries?.[0] ?? null;
}

function parseMessageField(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export const leadRoutes = Router();
leadRoutes.get('/', authMiddleware, async (req, res) => {
    try {
        const { businessId } = req.user;
        const { page = 1, limit = 10 } = req.query;
        let filter = { business: businessId };
        if (req.query.search) {
            filter.name = { $regex: req.query.search, $options: 'i' };
        }
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.tags) {
            filter.tags = { $in: req.query.tags.split(',') };
        }
        const leads = await Lead.find(filter).skip((page - 1) * limit).limit(limit);
        const total = await Lead.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Leads fetched successfully', data: leads, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch leads', error: error.message });
    }

});
leadRoutes.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const lead = await Lead.findById(id);
        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        res.status(200).json({ success: true, message: 'Lead fetched successfully', data: lead });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch lead', error: error.message });
    }
});
leadRoutes.post('/', authMiddleware, async (req, res) => {
    try {
        const { businessId } = req.user;
        const { name, template, contactDetails, source, tags, status, notes, data } = req.body;
        const lead = await Lead.create({ business: businessId, name, template, contactDetails, source, tags, status, notes, data });
        res.status(200).json({ success: true, message: 'Lead created successfully', data: lead });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to create lead', error: error.message });
    }
});
leadRoutes.patch('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        const lead = await Lead.findByIdAndUpdate(id, { status, notes }, { new: true, runValidators: true });
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
        res.status(200).json({ success: true, message: 'Lead updated successfully', data: lead });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to update lead', error: error.message });
    }
});
leadRoutes.post('/contact', authMiddleware, acceptContactBody, async (req, res) => {
    try {
        const business = req.user.business;
        const { id, channelId, conversationId, caption } = req.body;
        const action = req.body.action || 'sendMessage';
        if (!id || !channelId) {
            return res.status(400).json({ success: false, message: 'id and channelId are required' });
        }

        const [lead, channel] = await Promise.all([
            Lead.findOne({ _id: id, business }),
            Channel.findOne({ _id: channelId, business }),
        ]);
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
        if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

        await channel.populate('apiAuthenticator');
        await Providers.populate(channel, { path: 'apiAuthenticator.provider', select: 'name' });
        const providerName = channel.apiAuthenticator?.provider?.name;
        if (!providerName) return res.status(400).json({ success: false, message: 'Channel has no provider' });

        if (providerName === 'Whatsapp') {
            const details = lead.contactDetails || {};
            let toId = primaryEntry(details.whatsapp)?.handle;
            if (!toId) {
                const phone = primaryEntry(details.phone);
                const normalized = normalizePhoneNumber(phone?.handle, phone?.metadata?.country ?? 'IN');
                if (!normalized) return res.status(400).json({ success: false, message: 'Invalid phone number' });
                toId = normalized.countryCallingCode + normalized.nationalNumber;
            }
            const platformMeta = {
                accessToken: channel.apiAuthenticator.credentials.accessToken,
                phone_number_id: channel.config.phone_number_id,
            };

            let type;
            let data;
            let content;
            if (action === 'sendMessage') {
                const message = parseMessageField(req.body.message);
                if (!message?.type) return res.status(400).json({ success: false, message: 'message.type is required' });
                type = message.type;
                data = message.data;
                content = data;
            } else if (action === 'sendMedia') {
                if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
                const { buffer, mimetype, originalname } = req.file;
                const { id: mediaId } = await uploadFileToWhatsApp(buffer, mimetype, originalname, platformMeta);
                type = documentTypes.has(mimetype) ? 'document' : mimetype.split('/')[0];
                content = [{
                    id: mediaId,
                    mimeType: mimetype,
                    caption,
                    filename: originalname,
                    ref: { strategy: 'whatsapp_media_id', value: mediaId, needsAuth: true, url: `https://graph.facebook.com/v23.0/${mediaId}` },
                }];
                data = { id: mediaId, caption: type === 'document' ? caption : null };
            } else {
                return res.status(400).json({ success: false, message: 'action must be sendMessage or sendMedia for WhatsApp' });
            }

            let conversation = null;
            if (conversationId) {
                conversation = await Conversation.findOne({ _id: conversationId, business });
                if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });
                if (conversation.status !== 'open') await conversation.updateStatus('open');
            } else {
                const agent = await AgentModel.findOne({ business, channels: { $in: [channelId] } });
                conversation = await Conversation.create({
                    agent: agent?._id,
                    business,
                    channel: channelId,
                    lead: id,
                    externalConversationId: toId?.toString() ?? 'unknown',
                });
            }

            const result = await Message.create({
                conversation: conversation._id,
                business,
                externalMessageId: toId?.toString() ?? 'unknown',
                direction: 'outbound',
                sender: {
                    type: 'user',
                    id: req.user._id,
                    name: req.user.name,
                    ref: req.user._id,
                    refModel: 'Users',
                },
                type,
                kind: 'message',
                content,
                statusTimeline: { initiated: new Date() },
            });
            const outbound = { operation: 'sendMessage', toId, platformMeta, type, data, messageId: result._id.toString() };
            await sendKafkaMessage({ topic: 'sending-whatsapp-message', messages: [{ key: toId?.toString() ?? 'unknown', value: JSON.stringify(outbound) }] });
            await sendKafkaMessage({
                topic: 'socket-event',
                messages: [{ key: conversation._id.toString(), value: JSON.stringify({ nameSpace: 'CONVERSATION', roomId: conversation._id, event: 'message.send', payload: result }) }],
            });
            return res.status(200).json({ success: true, message: 'Lead contacted successfully', data: result });
        }

        if (providerName === 'Exotel') {
            const phone = primaryEntry(lead.contactDetails?.phone);
            const normalized = normalizePhoneNumber(phone?.handle, phone?.metadata?.country ?? 'IN');
            if (!normalized) return res.status(400).json({ success: false, message: 'Invalid phone number' });
            const leadPhoneNumber = normalized.nationalNumber;
            const { accountSid } = channel.apiAuthenticator.credentials;
            const { exophone, appId } = channel.config;
            const agentDetails = await AgentModel.findOne({ channels: channelId });
            let lastConversation = await Conversation.findOne({ lead: id, channel: channelId, business });
            if (!lastConversation) {
                lastConversation = await Conversation.create({
                    lead: id,
                    channel: channelId,
                    agent: agentDetails?._id,
                    business,
                    externalConversationId: leadPhoneNumber,
                });
            }
            const result = await CallSession.create({
                lead: id,
                agent: agentDetails?._id,
                conversation: lastConversation._id,
                business,
                channel: channel._id,
                direction: 'outbound-dial',
                statusTimeline: { initiatedAt: new Date() },
                callDetails: {
                    session: {
                        model: agentDetails?.modelConfig?.model,
                        sampleRate: 24000,
                        voice: agentDetails?.responseConfig?.audio?.output?.voice || agentDetails?.responseConfig?.realtimeOutputConfig?.voice,
                    },
                },
            });
            const body = {
                input: {
                    From: leadPhoneNumber,
                    CallerId: exophone,
                    Url: `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`,
                    StatusCallback: `https://chat.avakado.ai/webhook/${providerName}`,
                    Record: true,
                    CustomField: { callSession: result._id, business },
                },
                apiId: '6a50b6bf445a2fbf099b4a29',
                authId: channel.apiAuthenticator._id,
            };
            await axios.post('https://chat.avakado.ai/aux/external-api-call', body, { headers: { 'Content-Type': 'application/json' } });
            return res.status(200).json({ success: true, message: 'Call initiated successfully', data: result });
        }

        return res.status(400).json({ success: false, message: 'Invalid channel provider' });
    } catch (error) {
        console.error(error);
        const upstream = error?.response?.data?.message || error?.response?.data || error.message;
        res.status(500).json({ success: false, message: 'Failed to contact lead', error: typeof upstream === 'string' ? upstream : JSON.stringify(upstream) });
    }
});
// leadRoutes.delete('/:id', authMiddleware, async (req, res) => {
//     res.status(200).json({ message: 'Hello World' });
// });