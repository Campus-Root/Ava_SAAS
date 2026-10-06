
import { parsePhoneNumber } from 'libphonenumber-js';
import { CallSession } from '@avakado.ai/schemas';
import { Lead, applyContactWindow, contactWindowValue } from '@avakado.ai/schemas';
import { Conversation } from '@avakado.ai/schemas';
import { AgentModel } from '@avakado.ai/schemas';
import { Channel, negotiateCall } from '@avakado.ai/schemas';

export function sessionMedia({ channelName, channelConfig, agent }) {
    const media = negotiateCall({
        channelName,
        channelConfig,
        provider: agent?.modelConfig?.provider,
    });
    return {
        model: agent?.modelConfig?.model,
        sampleRate: media.channel.rate,
        voice: agent?.responseConfig?.audio?.output?.voice || agent?.responseConfig?.realtimeOutputConfig?.voice,
        media,
    };
}
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
    const callAt = new Date();
    let lead = await Lead.findOneAndUpdate(
        { business: businessId, "contactDetails.phone.handle": leadNumber },
        applyContactWindow({ $set: { lastInteractedAt: callAt } }, 'call', 'phone', callAt),
        { new: true },
    );
    if (!lead) {
        lead = await Lead.create({
            business: businessId,
            contactDetails: {
                phone: {
                    platform: 'Exotel',
                    handle: leadNumber,
                    label: "personal",
                    isPrimary: true,
                    metadata: normalizePhoneNumber(CallFrom) ?? {},
                    call: contactWindowValue('call', 'phone', callAt),
                }
            },
            source: `Exotel-${Direction}`,
            status: "new",
            data: {},
            lastInteractedAt: callAt,
        });
    }
    let conversation = await Conversation.findOneAndUpdate({ business: businessId, channel: channelId, lead: lead._id }, { $set: { status: "open" } }, { new: true });
    if (!conversation) {
        console.log("Conversation not found, creating new one with the details", {
            business: businessId, channel: channelId, lead: lead._id
        });
        conversation = await Conversation.create({ business: businessId, channel: channelId, agent: agentId, externalConversationId: leadNumber, lead: lead._id, status: "open" });
    }
    const agent = await AgentModel.findById(agentId);
    const channel = await Channel.findById(channelId).populate("provider");
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
            session: sessionMedia({
                channelName: channel?.provider?.name || "exotel",
                channelConfig: channel?.config,
                agent,
            }),
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

export function exotelMediaStreamUrl({ callSessionId, model, sampleRate, host = 'phone.avakado.ai' } = {}) {
    return buildUrlWithParams(`wss://${host}/media-stream`, {
        callSessionId,
        model,
        'sample-rate': sampleRate,
    });
}