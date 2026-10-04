import { cost as tokenCost } from '@avakado.ai/token-dollars';
import { Business } from '@avakado.ai/schemas';
import { creditsFromUsd, DEFAULT_SPEND_RATIO } from './creditsCycle.js';
import { sendKafkaMessage } from '../utils/kafka.js';

export const AI_CREDITS_MIN = 2;

export const AI_UNAVAILABLE_MESSAGE =
    'Avakado AI is temporarily unavailable for this workspace because credit balance is too low. Please top up credits to continue.';

/** Matches the Jev catalog rate when the installed token-dollars build does not list the model yet. */
const JEV_INPUT_USD_PER_MILLION = 0.042;

export async function assertAiCredits(businessId) {
    if (!businessId) return { ok: false, reason: 'business_missing', balance: 0 };
    const business = await Business.findById(businessId).select('credits');
    if (!business) return { ok: false, reason: 'business_not_found', balance: 0 };
    const balance = Number(business.credits?.balance) || 0;
    const active = business.credits?.active !== false;
    const ok = active && balance > AI_CREDITS_MIN;
    return { ok, balance, active, reason: ok ? null : (!active ? 'inactive' : 'low_balance') };
}

export function priceModelUsage(model, usage) {
    const priced = tokenCost(model, usage, { unknownReturnsZero: true });
    const unknown = (priced.warnings || []).some((warning) => /unknown model/i.test(String(warning)));
    if (!unknown || !/^jev([.-]|$)/i.test(String(model || ''))) return priced;

    const inputTokens = Number(usage?.input_tokens ?? usage?.input ?? usage?.prompt_tokens) || 0;
    const dollars = (inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MILLION;
    return {
        ...priced,
        total: dollars,
        currency: 'USD',
        provider: 'typesafe',
        warnings: [],
        breakdown: { ...(priced.breakdown || {}), textInput: dollars, textOutput: 0 },
    };
}

export async function chargeProviderUsage({ businessId, model, usage, idempotencyKey, note, meta } = {}) {
    if (!businessId) throw new Error('businessId is required');
    if (!model) throw new Error('model is required');
    if (!idempotencyKey) throw new Error('idempotencyKey is required');

    const priced = priceModelUsage(model, usage || {});
    const dollars = Number(priced.total) || 0;
    const business = await Business.findById(businessId)
        .select('credits')
        .populate('credits.currentSubscription', { spendRatio: 1 });
    if (!business) throw new Error('Business not found');

    const pricedCredits = creditsFromUsd(dollars, business.credits?.currentSubscription?.spendRatio, DEFAULT_SPEND_RATIO);
    const billing = {
        model,
        usage: usage || {},
        dollars,
        credits: pricedCredits.credits,
        spendRatio: pricedCredits.spendRatio,
        currency: priced.currency || 'USD',
        idempotencyKey,
        posted: false,
    };
    if (!(billing.credits > 0)) return billing;

    const payload = {
        businessId: String(businessId),
        direction: 'debit',
        credits: billing.credits,
        usage: { model, usage: usage || {} },
        idempotencyKey,
        note: note || 'AI usage',
        meta: {
            ...(meta || {}),
            billingMode: 'usage',
            model,
            spendRatio: billing.spendRatio,
            dollars,
            currency: billing.currency,
            provider: priced.provider,
            cost: {
                total: dollars,
                currency: billing.currency,
                breakdown: priced.breakdown,
                warnings: priced.warnings,
            },
        },
    };
    await sendKafkaMessage({
        topic: 'credit-ledger',
        messages: [{ key: String(businessId), value: JSON.stringify(payload) }],
        acks: -1,
    });
    billing.posted = true;
    return billing;
}
