/** Prepaid credit cycle: trial → Basic/Growth month → topup-in-month → expire leftover → next grant. */

export const FREE_TRIAL_DAYS = 14;
export const FREE_TRIAL_CREDITS = 3000;
export const DEFAULT_SPEND_RATIO = 1583;
export const PAID_PLAN_TYPES = new Set(['BASE', 'ENTERPRISE']);
export const TOPUP_STATUSES = new Set(['active', 'authenticated', 'pending_downgrade']);
export const CHANGEABLE_STATUSES = new Set(['active', 'authenticated', 'pending_downgrade', 'cancel_at_period_end']);

export function creditsDepleted(balance) {
    return !(Number(balance) > 0);
}

export function periodCompleted(periodEnd, now = new Date()) {
    return Boolean(periodEnd) && new Date(now).getTime() >= new Date(periodEnd).getTime();
}

/**
 * Upgrade/downgrade starts a new cycle immediately only when this month is already finished:
 * credits used up, or the current period has ended. Otherwise the new plan waits for period end.
 * Leftover monthly credits (including topups) do not carry; they expire with the month.
 */
export function planChangeApplyAt({ balance, periodEnd, now = new Date() } = {}) {
    if (creditsDepleted(balance) || periodCompleted(periodEnd, now)) return 'now';
    return 'cycle_end';
}

export function planChangeKind(currentPlan, targetPlan) {
    const currentAmt = Number(currentPlan?.amount?.value) || 0;
    const targetAmt = Number(targetPlan?.amount?.value) || 0;
    if (targetAmt > currentAmt) return 'upgrade';
    if (targetAmt < currentAmt) return 'downgrade';
    const currentCredits = Number(currentPlan?.credits) || 0;
    const targetCredits = Number(targetPlan?.credits) || 0;
    if (targetCredits > currentCredits) return 'upgrade';
    if (targetCredits < currentCredits) return 'downgrade';
    return 'same';
}

export function cycleGrantKeys({ subscriptionId, paidCount, planCode } = {}) {
    const cycle = `subscription:${subscriptionId}:cycle:${paidCount}:plan:${planCode || 'unknown'}`;
    return { expire: `${cycle}:expire`, credit: `${cycle}:credit` };
}

export function expireKeyFromGrantKey(idempotencyKey) {
    if (!idempotencyKey) return undefined;
    const key = String(idempotencyKey);
    if (key.endsWith(':expire')) return key;
    if (key.endsWith(':credit')) return key.replace(/:credit$/, ':expire');
    return `${key}:expire`;
}

export function expireThenGrant(creditsPerCycle) {
    return [
        { direction: 'reset', credits: 0 },
        { direction: 'credit', credits: Number(creditsPerCycle) || 0 },
    ];
}

export function creditsFromUsd(dollars, spendRatio, fallback = DEFAULT_SPEND_RATIO) {
    const ratio = Number(spendRatio);
    const used = Number.isFinite(ratio) && ratio > 0 ? ratio : fallback;
    return { credits: Number(dollars) * used, spendRatio: used };
}

export function topupWindow({ subscription, now = new Date() } = {}) {
    if (!subscription) return { ok: false, reason: 'no_subscription' };
    if (!TOPUP_STATUSES.has(subscription.status)) return { ok: false, reason: 'not_active' };
    if (periodCompleted(subscription.billing?.periodEnd, now)) return { ok: false, reason: 'period_ended' };
    return { ok: true };
}

export function shouldApplyPendingChange(pendingChange, { event, notes, now = new Date() } = {}) {
    if (!pendingChange?.targetPlan && !pendingChange?.targetPlanCode) return false;
    const due = !pendingChange.applyAt || new Date(pendingChange.applyAt) <= now;
    if (event === 'subscription.charged' && due) return true;
    if (event === 'subscription.updated' && (notes?.action === 'upgrade' || notes?.action === 'downgrade') && due) return true;
    return due && ['subscription.charged', 'subscription.updated'].includes(event);
}

export function periodEndResetJob(subscription) {
    const paidCount = subscription?.billing?.paidCount ?? 0;
    const idempotencyKey = `sub_reset_${subscription._id}_${paidCount}`;
    return {
        idempotencyKey,
        name: `reset-credits-${subscription._id}`,
        body: {
            businessId: String(subscription.business),
            subscriptionId: String(subscription._id),
            idempotencyKey,
            note: 'Period-end reset (unused plan credits and topups expire)',
        },
        runAt: subscription?.billing?.periodEnd || subscription?.billing?.nextChargeAt,
    };
}
