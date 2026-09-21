import { Router } from 'express';
import { Conversation } from '@avakado.ai/schemas';
import { authMiddleware } from '../middleware/auth.js';
import { Message } from '@avakado.ai/schemas';
import { CallSession } from '@avakado.ai/schemas';
import { sendKafkaMessage } from '../utils/kafka.js';
import { humanHandoffSet, humanHandoffSocketValue } from '../services/conversationEvents.js';
export const conversationRoutes = Router();
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