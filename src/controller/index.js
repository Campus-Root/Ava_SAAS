import { Router } from 'express';
import { sendMail } from '../utils/sendEmail.js';
import { Ticket } from '@avakado.ai/schemas';
import { AgentModel } from '@avakado.ai/schemas';
import { exotelMediaStreamUrl, getCallSessionForIncomingCall, getCallSessionForOutboundDial } from '../utils/CallSessions.js';
import { contactUsValidation } from '../services/contactUs.js';
import { Channel } from '@avakado.ai/schemas';
import { Lead } from '@avakado.ai/schemas';
import { Conversation } from '@avakado.ai/schemas';
import { leadRoutes } from './leadsRouter.js';
import { conversationRoutes } from './conversationRouter.js';
export const builtInRoutes = Router();
builtInRoutes.get('/', (_, res) => res.status(200).send('Server running'));
builtInRoutes.use('/lead', leadRoutes);
builtInRoutes.use('/conversation', conversationRoutes);
builtInRoutes.get('/exotel-redirect', async (request, reply) => {
    const { channelId, CallSid, CallFrom, CallTo, Direction, CustomField = "{}" } = request.query;
    // console.log(JSON.stringify({ query: request.query }, null, 2))
    const agent = await AgentModel.findOne({ channels: channelId }).populate("business actions");
    if (!agent) {
        console.error("❌", "Agent not found");
        return reply.status(404).send('Agent not found');
    }
    let businessId = agent.business._id, agentId = agent._id;
    let callSession = null;
    try {
        switch (Direction) {
            case 'outbound-dial':
            case 'outbound-api':
                callSession = await getCallSessionForOutboundDial(request.query);
                break;
            case 'incoming':
                callSession = await getCallSessionForIncomingCall({ CallSid, CallTo, CallFrom, Direction, businessId, channelId, agentId, CustomField }, request.query);
                break;
            default: return reply.status(400).send('Invalid direction');
        }
        if (!callSession) {
            console.error("❌", "Call session not found");
            return reply.status(404).send('Call session not found');
        }
        const wssUrl = exotelMediaStreamUrl({
            callSessionId: callSession._id,
            model: callSession.callDetails.session.model,
            sampleRate: callSession.callDetails.session.sampleRate,
        });
        console.log("🚀 ~ builtInRoutes.get ~ wssUrl:", wssUrl)
        return reply.type('application/json').send({ url: wssUrl });
    } catch (error) {
        console.error(error);
        return reply.status(500).json({ success: false, error: error.message, message: 'Internal server error' });
    }

})
builtInRoutes.get('/initiate-conversation', async (req, res) => {
    const { channelId, externalConversationId, leadId } = req.query;
    let conversation = await Conversation.findOne({ channel: channelId, lead: leadId }).populate("lead", "name _id");
    if (conversation) return res.status(200).json({ success: true, message: "Conversation already exists", data: conversation });
    const channel = await Channel.findById(channelId, { business: 1, agent: 1, _id: 1 })
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
    const agent = await AgentModel.findOne({ channels: { $in: [channel._id] } }, { _id: 1 })
    if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
    let lead = await Lead.findById(leadId);
    if (!lead) lead = await Lead.create({ business: channel.business, name: "Anonymous", source: "webchat", tags: ["webchat"] });
    conversation = await Conversation.create({ business: channel.business, channel: channel._id, agent: agent._id, externalConversationId, lead: lead._id })
    await conversation.populate("lead", "name _id");
    res.status(200).json({ success: true, message: "Conversation initiated successfully", data: conversation });
});
builtInRoutes.get('/get-agent', async (req, res) => {
    try {
        const { channelId } = req.query
        const channel = await Channel.findById(channelId, { name: 1, config: 1, _id: 1 })
        if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });
        const agent = await AgentModel.findOne({ channels: channel._id }, "personalInfo.name personalInfo.avatar _id");
        if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
        res.status(200).json({ success: true, message: "Agent found", data: { agent, channel } });
    } catch (error) {
        console.error("❌", error);
        res.status(500).json({ success: false, message: "An error occurred", error: error.message });
    }
});
builtInRoutes.post('/contact-us', async (req, res) => {
    try {
        const { name, contactDetails, purpose } = req.body;
        const check = contactUsValidation({ name, contactDetails, purpose });
        if (!check.ok) return res.status(check.status).json({ error: check.error });
        const { email, phone } = contactDetails;
        const subject = `New Contact Request from ${name}`;
        const text = ` New contact form submission:
                Name: ${name}
                Email: ${email || 'N/A'}
                Phone: ${phone || 'N/A'}
                Purpose: ${purpose}`.trim();
        const html = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email || 'N/A'}</p>
    <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
    <p><strong>Purpose:</strong><br>${purpose}</p>
`;
        await Promise.all([
            // await Lead.create({ name, purpose, contactDetails: { email: email || null, phone: phone || null } }),
            await sendMail({ to: "ankit@onewindow.co anurag@onewindow.co vishnu.teja101.vt@gmail.com", subject, text, html })
        ]);
        return res.json({ success: true, message: 'we will get back to you soon', data: null });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, error: error.message, message: 'Internal server error' });
    }
})
builtInRoutes.post("/raise-ticket", async (req, res) => {
    try {
        const { business, issueSummary, channel, priority, contactDetails, notifierEmail } = req.body;
        await Ticket.create({ business, issueSummary, channel, priority, contactDetails, notifierEmail });
        return res.status(201).json({ message: "ticket raised successfully" });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
    }
})

