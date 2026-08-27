import { Router } from 'express';
import { Conversation } from '../models/Conversations.js';
import { authMiddleware } from '../middleware/auth.js';
import { Message } from '../models/Messages.js';
import { CallSession } from '../models/CallSessions.js';
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
    const conversation = await Conversation.findByIdAndUpdate(id, {
        status: 'pending',
        "config.assignment": {
            agentReply: false,
            handoffReason,
            handoffUrgency,
            assignedAt: new Date(),
            assignedTo
        }
    }, { new: true });
    // send an realtime soceket event
    // await RealtimeServer.notifyRooms("CONVERSATION", this.business.toString(), "conversation.humanHandoff", { conversationId: this.toObject(), config: this.config });
    // delete and unschedule the scheduled jobs
    // await prisma.job.deleteMany({ where: { id: { in: [`${this._id.toString()}_followup_1`, `${this._id.toString()}_followup_2`] } } })
    // unscheduleJob(`${this._id.toString()}_followup_1`);
    // unscheduleJob(`${this._id.toString()}_followup_2`);
    res.status(200).json(conversation);
});