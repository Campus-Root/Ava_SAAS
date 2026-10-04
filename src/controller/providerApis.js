import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getOpenAIClient } from '@avakado.ai/providers';
import { authMiddleware } from '../middleware/auth.js';
import { callJev } from '../services/avakadoApis.js';
import { AI_UNAVAILABLE_MESSAGE, assertAiCredits, chargeProviderUsage } from '../services/providerUsage.js';

export const providerRoutes = Router();

function idempotencyKey(req, fallback) {
    const header = req.get('Idempotency-Key');
    if (header && String(header).trim()) return String(header).trim().slice(0, 200);
    return fallback;
}

async function gate(req, res) {
    const businessId = req.user?.business?._id ?? req.user?.business ?? null;
    if (!businessId) {
        res.status(403).json({ success: false, message: 'This account is not attached to a business' });
        return null;
    }
    const credits = await assertAiCredits(businessId);
    if (!credits.ok) {
        res.status(402).json({ success: false, message: AI_UNAVAILABLE_MESSAGE, balance: credits.balance });
        return null;
    }
    return businessId;
}

providerRoutes.post('/jev', authMiddleware, async (req, res) => {
    try {
        const businessId = await gate(req, res);
        if (!businessId) return;

        const { state, questions, model } = req.body || {};
        const result = await callJev({ state, questions, model });
        if (!result.success) {
            const status = result.error?.status || 502;
            return res.status(status).json({ success: false, message: result.error?.message || 'Jev request failed' });
        }

        const billing = await chargeProviderUsage({
            businessId,
            model: result.data?.model || model || 'jev-latest',
            usage: result.data?.usage || {},
            idempotencyKey: idempotencyKey(req, `jev:${businessId}:${randomUUID()}`),
            note: 'Jev usage',
            meta: { provider: 'Jev', requestedModel: model || 'jev-latest' },
        });
        return res.status(200).json({ success: true, data: result.data, billing });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

providerRoutes.post('/openai', authMiddleware, async (req, res) => {
    try {
        const body = req.body || {};
        if (body.stream) {
            return res.status(400).json({ success: false, message: 'This endpoint returns the completed response so usage can be billed' });
        }
        if (!body.model || typeof body.model !== 'string') {
            return res.status(400).json({ success: false, message: 'model is required' });
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
            return res.status(400).json({ success: false, message: 'messages must contain at least one message' });
        }

        const businessId = await gate(req, res);
        if (!businessId) return;

        const { apiKey, api_key, stream, idempotencyKey: _idempotencyKey, ...request } = body;
        void apiKey;
        void api_key;
        void stream;
        void _idempotencyKey;

        let completion;
        try {
            completion = await getOpenAIClient().chat.completions.create({ ...request, stream: false });
        } catch (error) {
            const status = error?.status || 502;
            const message = error?.error?.message || error?.message || 'OpenAI request failed';
            return res.status(status).json({ success: false, message });
        }

        const billing = await chargeProviderUsage({
            businessId,
            model: completion.model || body.model,
            usage: completion.usage || {},
            idempotencyKey: idempotencyKey(req, `openai:${businessId}:${completion.id}`),
            note: 'OpenAI usage',
            meta: { provider: 'OpenAI', requestedModel: body.model },
        });
        return res.status(200).json({ success: true, data: completion, billing });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
