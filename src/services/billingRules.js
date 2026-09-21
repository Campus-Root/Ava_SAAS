import { FREE_TRIAL_DAYS, FREE_TRIAL_CREDITS, topupWindow } from './creditsCycle.js';

export function canClaimFreeTrial(credits = {}, now = new Date()) {
    if (credits.freeTrailClaimed) return { ok: false, reason: 'already_claimed' };
    if (credits.freeTrailExpiry && new Date(credits.freeTrailExpiry) > now) return { ok: false, reason: 'not_expired' };
    if (credits.currentSubscription) return { ok: false, reason: 'has_subscription' };
    return { ok: true };
}

export function freeTrialGrant(now = new Date()) {
    const freeTrailExpiry = new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    return {
        balance: FREE_TRIAL_CREDITS,
        days: FREE_TRIAL_DAYS,
        freeTrailExpiry,
        freeTrailClaimed: true,
        active: true,
    };
}

export function freeTrialResetJob(businessId, freeTrailExpiry) {
    const idempotencyKey = `free_trail_reset_${businessId}`;
    return {
        idempotencyKey,
        name: 'Free trail reset',
        body: {
            businessId,
            idempotencyKey,
            note: 'Free trail reset',
            meta: { businessId, freeTrailClaimed: true, freeTrailExpiry },
        },
        runAt: freeTrailExpiry,
    };
}

export function freeTrialRunUrl(businessId) {
    return `https://socketio.avakado.ai/api/cron/free_trail_reset_${businessId}/run`;
}

export function topupAllowed(plan, subscription, planId, now = new Date()) {
    if (!plan) return { ok: false, reason: 'plan_not_found' };
    if (plan.type !== 'TOPUP') return { ok: false, reason: 'not_topup' };
    const window = topupWindow({ subscription, now });
    if (!window.ok) return window;
    const allowed = subscription.plan?.allowedTopUps ?? [];
    const ok = allowed.some((id) => String(id) === String(planId));
    return ok ? { ok: true } : { ok: false, reason: 'not_allowed' };
}

export function buildTopupPaymentDoc({ businessId, plan, currentSubscription, rzpOrder }) {
    return {
        business: businessId,
        subscription: currentSubscription._id,
        gateway: 'razorpay',
        gatewayReference: { orderId: rzpOrder.id, action: 'topup', planId: plan._id.toString() },
        status: 'authorized',
        amount: plan.amount,
        notes: {
            planId: plan._id.toString(),
            planCode: plan.code,
            action: 'topup',
            credits: String(plan.credits || 0),
        },
    };
}
