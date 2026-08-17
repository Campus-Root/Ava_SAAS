
import { parsePhoneNumber } from 'libphonenumber-js';
import { CallSession } from '../models/CallSessions.js';
import { Lead } from '../models/Leads.js';
import { Conversation } from '../models/Conversations.js';
import { AgentModel } from '../models/Agent.js';
export const normalizePhoneNumber = (rawNumber, defaultCountry = 'IN') => {
    if (!rawNumber) return null;

    try {
        const phoneNumber = parsePhoneNumber(rawNumber, defaultCountry);
        if (phoneNumber && phoneNumber.isValid()) {
            return {
                number: phoneNumber.number,// returns E.164, e.g. "+919959964639"
                countryCallingCode: phoneNumber.countryCallingCode,
                country: phoneNumber.country,
                nationalNumber: phoneNumber.nationalNumber
            };
        }
        return null;
    } catch (err) {
        console.warn(`Failed to parse phone number "${rawNumber}":`, err.message);
        return null;
    }
}

export const getCallSessionForIncomingCall = async ({ CallSid, CallTo, CallFrom, Direction, businessId, channelId, agentId }, requestBody = {}) => {
    let businessNumber = normalizePhoneNumber(CallTo)?.number ?? CallTo;
    let leadNumber = normalizePhoneNumber(CallFrom)?.number ?? CallFrom;
    let lead = await Lead.findOneAndUpdate({ business: businessId, "contactDetails.phone.handle": leadNumber }, { $set: { lastInteractedAt: new Date() } }, { new: true });
    if (!lead) {
        lead = await Lead.create({
            business: businessId,
            contactDetails: {
                phone: {
                    platform: 'Exotel',
                    handle: leadNumber,
                    label: "personal",
                    isPrimary: true,
                    metadata: normalizePhoneNumber(CallFrom) ?? {}
                }
            },
            source: `Exotel-${Direction}`,
            status: "new",
            data: {},
            lastInteractedAt: new Date(),
        });
    }
    let conversation = await Conversation.findOneAndUpdate({ business: businessId, channel: channelId, externalConversationId: normalizePhoneNumber(CallFrom)?.number, lead: lead._id }, { $set: { status: "open" } }, { new: true });
    if (!conversation) {
        console.log("Conversation not found, creating new one with teh details", {
            business: businessId, channel: channelId, externalConversationId: normalizePhoneNumber(CallFrom)?.number, lead: lead._id
        });
        conversation = await Conversation.create({ business: businessId, channel: channelId, agent: agentId, externalConversationId: CallFrom, lead: lead._id, status: "open" });
    }
    const agent = await AgentModel.findById(agentId);
    const callSession = await CallSession.create({
        lead: lead._id,
        agent: agentId,
        conversation: conversation._id,
        business: businessId,
        channel: channelId,
        externalCallSessionId: CallSid,
        direction: Direction,
        statusTimeline: { initiatedAt: new Date(), ringingAt: new Date() },
        callDetails: {
            session: {
                model: agent.modelConfig.model,
                sampleRate: 24000,
                voice: agent.responseConfig?.audio?.output?.voice || agent.responseConfig?.realtimeOutputConfig?.voice,
            }
        },
        sequenceOfEvents: [requestBody]
    });
    return callSession;
}
export const getCallSessionForOutboundDial = async (body) => {
    const { CallSid, CustomField } = body;
    const { callSession: callSessionId, campaign, business } = JSON.parse(CustomField);
    const callSession = await CallSession.findByIdAndUpdate(callSessionId, { $set: { externalCallSessionId: CallSid, "statusTimeline.ringingAt": new Date() }, $push: { sequenceOfEvents: body } }, { new: true });
    return callSession;
}
export const buildUrlWithParams = (baseUrl, params) => {
    const paramsString = new URLSearchParams(
        Object.entries(params)
            .filter(([, value]) => value != null)
            .map(([key, value]) => [key, String(value)])
    ).toString();
    return paramsString ? `${baseUrl}?${paramsString}` : baseUrl;
};