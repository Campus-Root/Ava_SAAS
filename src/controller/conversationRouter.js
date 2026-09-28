import { Router } from 'express';
import { CallSession, Conversation, Message } from '@avakado.ai/schemas';
import { authMiddleware } from '../middleware/auth.js';
import { sendKafkaMessage } from '../utils/kafka.js';
import { humanHandoffSet, humanHandoffSocketValue } from '../services/conversationEvents.js';
export const conversationRoutes = Router();

function createdAtWindow(from, to) {
    if (!from && !to) return null;
    const createdAt = {};
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    return createdAt;
}

function idList(...values) {
    const ids = values.flatMap((value) => (value ? String(value).split(',') : []));
    return ids.length ? ids : null;
}

conversationRoutes.get('/', authMiddleware, async (req, res) => {
    try {
        const { business } = req.user;
        const { page = 1, limit = 10, status, priority, id, leadId, leadIds, channelId, channelIds, agentIds, campaignIds, from, to } = req.query;
        const filter = { business };
        if (id) filter._id = id;
        if (status) filter.status = status;
        if (priority) filter.priority = priority;
        const leads = idList(leadId, leadIds);
        const channels = idList(channelId, channelIds);
        const agents = idList(agentIds);
        const campaigns = idList(campaignIds);
        if (leads) filter.lead = { $in: leads };
        if (channels) filter.channel = { $in: channels };
        if (agents) filter.agent = { $in: agents };
        if (campaigns) filter.campaign = { $in: campaigns };
        const createdAt = createdAtWindow(from, to);
        if (createdAt) filter.createdAt = createdAt;
        const conversations = await Conversation.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit);
        const total = await Conversation.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Conversations fetched successfully', data: conversations, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch conversations', error: error.message });
    }
});

conversationRoutes.get('/:id/messages', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { business } = req.user;
        const { page = 1, limit = 20, from, to } = req.query;
        const conversation = await Conversation.findOne({ _id: id, business });
        if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });
        const filter = { conversation: id, business };
        const createdAt = createdAtWindow(from, to);
        if (createdAt) filter.createdAt = createdAt;
        const messages = await Message.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const total = await Message.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Messages fetched successfully', data: messages, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch messages', error: error.message });
    }
});

conversationRoutes.get('/:id/call-sessions', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { business } = req.user;
        const { page = 1, limit = 20, from, to, direction, externalCallSessionId } = req.query;
        const conversation = await Conversation.findOne({ _id: id, business });
        if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found' });
        const filter = { conversation: id, business };
        const createdAt = createdAtWindow(from, to);
        if (createdAt) filter.createdAt = createdAt;
        if (direction) filter.direction = { $in: direction.split(',') };
        if (externalCallSessionId) filter.externalCallSessionId = externalCallSessionId;
        const callSessions = await CallSession.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const total = await CallSession.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Call sessions fetched successfully', data: callSessions, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch call sessions', error: error.message });
    }
});

conversationRoutes.get('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { business } = req.user;
    const { from, to } = req.query;
    const messages = await Message.find({ conversation: id, business: business, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 });
    const callSessions = await CallSession.find({ conversation: id, business: business, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 });
    res.status(200).json({ callSessions, messages });
});
conversationRoutes.patch('/human-handoff/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { business } = req.user;
    const { handoffReason = "Lead explicitly asked for a human agent", handoffUrgency = "normal", assignedTo = "human" } = req.body;
    const conversation = await Conversation.findOneAndUpdate(
        { _id: id, business },
        { $set: humanHandoffSet({ handoffReason, handoffUrgency, assignedTo }) },
        { new: true }
    );
    if (!conversation) return res.status(404).json({ success: false, message: "Conversation not found" });
    const socket = humanHandoffSocketValue(conversation);
    await sendKafkaMessage({
        topic: "socket-event",
        message: { key: String(conversation._id), value: JSON.stringify(socket) },
        acks: -1,
    });
    res.status(200).json(conversation);
});