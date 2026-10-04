import { AgentModel, Api, Conversation, Lead, Message, Providers, contactWindowIsOpen, storedContactWindow } from '@avakado.ai/schemas';
import { sendKafkaMessage } from './kafka.js';

export const INSTAGRAM_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

const SEND_TOPICS = {
    Telegram: 'sending-telegram-message',
    Instagram: 'sending-instagram-message',
};

const SEND_API_TITLES = {
    Telegram: 'Telegram.message.send',
    Instagram: 'Instagram.message.send',
};

export function primaryHandle(entries) {
    return entries?.find((entry) => entry.isPrimary)?.handle ?? entries?.[0]?.handle ?? null;
}

export async function instagramWindowOpen(leadId, channelId, at = new Date()) {
    const conversationIds = await Conversation.find({ lead: leadId, channel: channelId }).distinct('_id');
    if (!conversationIds.length) return false;
    const last = await Message.findOne({ conversation: { $in: conversationIds }, direction: 'inbound' })
        .sort({ createdAt: -1 })
        .select('createdAt statusTimeline.initiated');
    const inboundAt = last?.statusTimeline?.initiated || last?.createdAt;
    if (!inboundAt) return false;
    return new Date(at).getTime() - new Date(inboundAt).getTime() < INSTAGRAM_MESSAGING_WINDOW_MS;
}

export function telegramReplyMarkup(buttons) {
    if (!Array.isArray(buttons) || !buttons.length) return undefined;
    const rows = buttons.map((row) => {
        const cells = Array.isArray(row) ? row : [row];
        return cells.map((button) => ({
            text: button.text,
            callback_data: button.callback_data || button.payload || button.text,
        }));
    });
    return { inline_keyboard: rows };
}

export function instagramSendPayload({ to, text, quickReplies }) {
    const message = { text };
    if (Array.isArray(quickReplies) && quickReplies.length) {
        message.quick_replies = quickReplies.slice(0, 13).map((reply) => ({
            content_type: 'text',
            title: String(reply.title || reply.text).slice(0, 20),
            payload: String(reply.payload || reply.title || reply.text).slice(0, 1000),
        }));
    }
    return {
        recipient: { id: String(to) },
        messaging_type: 'RESPONSE',
        message,
    };
}

function telegramRequestTemplate() {
    return {
        method: 'POST',
        url: {
            base: 'https://api.telegram.org',
            path: "{{'/bot' + (auth.credentials.apiToken || auth.credentials.apiKey) + '/sendMessage'}}",
            params: {},
        },
        headers: { 'Content-Type': 'application/json' },
        body: {
            chat_id: '{{input.to}}',
            text: '{{input.text}}',
            reply_markup: '{{input.reply_markup}}',
        },
    };
}

function instagramRequestTemplate() {
    return {
        method: 'POST',
        url: {
            base: 'https://graph.instagram.com/v23.0',
            path: '/me/messages',
            params: {},
        },
        headers: {
            'Content-Type': 'application/json',
            Authorization: "{{'Bearer ' + auth.credentials.accessToken}}",
        },
        body: '{{input.payload}}',
    };
}

export async function ensureSendApi(providerName) {
    const provider = await Providers.findOne({ name: providerName });
    if (!provider) throw new Error(`Provider ${providerName} not found`);
    const title = SEND_API_TITLES[providerName];
    let api = await Api.findOne({ provider: provider._id, title });
    if (api) return api;
    api = await Api.create({
        provider: provider._id,
        title,
        description: providerName === 'Telegram' ? 'Send a Telegram bot message' : 'Send an Instagram direct message',
        version: 'v1',
        schemas: { auth: providerName === 'Telegram' ? 'apiKey' : 'oauth2' },
        requestTemplate: providerName === 'Telegram' ? telegramRequestTemplate() : instagramRequestTemplate(),
        metadata: { category: 'messaging', feature: 'send' },
    });
    return api;
}

export async function directMessageLeadTarget({ providerName, lead, channelId, at = new Date() }) {
    if (providerName === 'Telegram') {
        const to = primaryHandle(lead.contactDetails?.telegram);
        if (!to) return { error: 'Telegram chat id not found' };
        const window = storedContactWindow(lead, 'chat', 'telegram');
        if (window && !contactWindowIsOpen(window, at)) return { error: 'Telegram chat is closed for this lead' };
        return { to };
    }
    if (providerName === 'Instagram') {
        const to = primaryHandle(lead.contactDetails?.instagram);
        if (!to) return { error: 'Instagram id not found' };
        const window = storedContactWindow(lead, 'chat', 'instagram');
        const open = window
            ? contactWindowIsOpen(window, at)
            : await instagramWindowOpen(lead._id, channelId, at);
        if (!open) return { error: 'Instagram 24-hour messaging window is closed' };
        return { to };
    }
    return { error: 'Unsupported provider' };
}

function outboundFromMessage(providerName, message) {
    const type = message?.type || 'text';
    const data = message?.data || {};
    const body = data.body || data.text;
    if (!body) return { error: 'message.data.body is required' };
    if (type === 'text') return { type: 'text', data: { body }, content: { body } };
    if (type === 'image') {
        const link = data.link || data.url;
        if (!link) return { error: 'message.data.link is required' };
        return { type: 'image', data: { link }, content: { url: link, caption: data.caption || null } };
    }
    if (type === 'interactive' && providerName === 'Telegram') {
        const reply_markup = data.reply_markup || telegramReplyMarkup(data.buttons);
        return { type: 'interactive', data: { body, reply_markup }, content: { body, reply_markup } };
    }
    if (type === 'interactive' && providerName === 'Instagram') {
        return {
            type: 'interactive',
            data: { body, quick_replies: data.quick_replies },
            content: { body, quick_replies: data.quick_replies },
        };
    }
    return { error: 'Unsupported message type' };
}

export async function contactDirectMessage({ providerName, lead, channel, conversationId, message, businessId, user }) {
    const topic = SEND_TOPICS[providerName];
    if (!topic) return { ok: false, status: 400, message: 'Invalid channel provider' };
    const target = await directMessageLeadTarget({ providerName, lead, channelId: channel._id });
    if (target.error) return { ok: false, status: 400, message: target.error };
    const outbound = outboundFromMessage(providerName, message);
    if (outbound.error) return { ok: false, status: 400, message: outbound.error };

    const creds = channel.apiAuthenticator?.credentials || {};
    const platformMeta = providerName === 'Telegram'
        ? { apiToken: creds.apiToken ?? creds.apiKey }
        : { accessToken: creds.accessToken, igUserId: channel.config?.igUserId ?? creds.igUserId };

    let conversation = null;
    if (conversationId) {
        conversation = await Conversation.findOne({ _id: conversationId, business: businessId });
        if (!conversation) return { ok: false, status: 404, message: 'Conversation not found' };
        if (conversation.status !== 'open') await conversation.updateStatus('open');
    } else {
        const agent = await AgentModel.findOne({ business: businessId, channels: { $in: [channel._id] } });
        conversation = await Conversation.create({
            agent: agent?._id,
            business: businessId,
            channel: channel._id,
            lead: lead._id,
            externalConversationId: String(target.to),
        });
    }

    const messageDoc = await Message.create({
        conversation: conversation._id,
        business: businessId,
        direction: 'outbound',
        sender: {
            type: 'user',
            id: user._id,
            name: user.name,
            ref: user._id,
            refModel: 'Users',
        },
        type: outbound.type,
        kind: 'message',
        content: outbound.content,
        statusTimeline: { initiated: new Date() },
    });
    const payload = {
        operation: 'sendMessage',
        toId: target.to,
        platformMeta,
        type: outbound.type,
        data: outbound.data,
        messageId: messageDoc._id.toString(),
    };
    await sendKafkaMessage({
        topic,
        messages: [{ key: String(target.to), value: JSON.stringify(payload) }],
    });
    await sendKafkaMessage({
        topic: 'socket-event',
        messages: [{
            key: conversation._id.toString(),
            value: JSON.stringify({ nameSpace: 'CONVERSATION', roomId: conversation._id, event: 'message.send', payload: messageDoc }),
        }],
    });
    return { ok: true, messageDoc };
}

export async function validateDirectMessageCampaign({ providerName, leadIds, channelId, runtime }) {
    if (!runtime?.text || !String(runtime.text).trim()) {
        return { fatal: 'runtime.text is required', leadErrors: [] };
    }
    const leadErrors = [];
    for (const leadId of leadIds || []) {
        const lead = await Lead.findById(leadId);
        if (!lead) {
            leadErrors.push({ leadId, error: 'Lead not found' });
            continue;
        }
        const target = await directMessageLeadTarget({ providerName, lead, channelId });
        if (target.error) leadErrors.push({ leadId, error: target.error });
    }
    return { fatal: null, leadErrors };
}

export async function buildDirectMessageTasks({ providerName, leadIds, channel, businessId, user, scheduledAt, runtime, campaignId }) {
    const text = runtime?.text;
    if (!text || !String(text).trim()) throw new Error('runtime.text is required');
    const api = await ensureSendApi(providerName);
    const authId = channel.apiAuthenticator?._id ?? channel.apiAuthenticator;
    const tasks = [];
    for (const leadId of leadIds) {
        const lead = await Lead.findById(leadId);
        if (!lead) throw new Error('Lead not found');
        const target = await directMessageLeadTarget({ providerName, lead, channelId: channel._id, at: scheduledAt });
        if (target.error) throw new Error(`${target.error} (${leadId})`);
        let conversation = await Conversation.findOne({ lead: leadId, channel: channel._id, business: businessId });
        if (!conversation) {
            const agent = await AgentModel.findOne({ channels: channel._id });
            conversation = await Conversation.create({
                lead: leadId,
                channel: channel._id,
                agent: agent?._id,
                business: businessId,
                externalConversationId: String(target.to),
            });
        }
        const replyMarkup = providerName === 'Telegram' ? telegramReplyMarkup(runtime.buttons) : undefined;
        const quickReplies = providerName === 'Instagram' ? runtime.quickReplies : undefined;
        const content = { body: text };
        if (replyMarkup) content.reply_markup = replyMarkup;
        if (quickReplies) content.quick_replies = quickReplies;
        const hasButtons = Boolean(replyMarkup || (Array.isArray(quickReplies) && quickReplies.length));
        const message = await Message.create({
            conversation: conversation._id,
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
            type: hasButtons ? 'interactive' : 'text',
            kind: 'message',
            content,
            statusTimeline: { scheduled: scheduledAt },
        });
        const input = providerName === 'Telegram'
            ? { to: target.to, text, reply_markup: replyMarkup }
            : { payload: instagramSendPayload({ to: target.to, text, quickReplies }) };
        tasks.push({
            lead: leadId,
            type: 'quick',
            data: { input, apiId: api._id, authId },
            references: { type: 'Message', id: message._id },
        });
    }
    return tasks;
}
