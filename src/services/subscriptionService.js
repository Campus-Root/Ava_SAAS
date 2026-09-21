import { CURRENT_SUBSCRIPTION_STATUSES, Subscription } from "@avakado.ai/schemas";
import { Plan } from "@avakado.ai/schemas";
import { Business } from "@avakado.ai/schemas";
import { GraphQLError } from "graphql";
import axios from "axios";
import { RazorPayService } from "./razorPayService.js";
import { PAID_PLAN_TYPES, CHANGEABLE_STATUSES, planChangeApplyAt, planChangeKind, periodEndResetJob } from "./creditsCycle.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;


export const razorpayPlanId = (plan) => plan?.paymentGateWay?.razorpay?.plan_id;

const toUnixDate = (unix) => (unix ? new Date(Number(unix) * 1000) : null);

export const checkoutSubscription = (rzpSub, amount, currency = "INR") => ({
    keyId: RazorPayService.getPublicKey(),
    mode: "subscription",
    subscriptionId: rzpSub?.id || null,
    orderId: null,
    amount: amount?.value ?? 0,
    amountPaise: Math.round((amount?.value ?? 0) * 100),
    currency: amount?.currency || currency,
    shortUrl: rzpSub?.short_url || null
});

export const checkoutOrder = (order, amountRupees, currency = "INR") => ({
    keyId: RazorPayService.getPublicKey(),
    mode: "order",
    subscriptionId: null,
    orderId: order?.id || null,
    amount: amountRupees,
    amountPaise: Math.round(amountRupees * 100),
    currency: order?.currency || currency,
    shortUrl: null
});

export const supersedeCurrent = async (businessId, { reason, exceptId } = {}) => {
    const filter = {
        business: businessId,
        status: { $in: CURRENT_SUBSCRIPTION_STATUSES }
    };
    if (exceptId) filter._id = { $ne: exceptId };
    const current = await Subscription.findOne(filter).sort({ createdAt: -1 });
    if (!current) return null;
    if (current.gateway === "razorpay" && current.gatewaySubscriptionId) {
        try {
            await RazorPayService.cancelSubscription(current.gatewaySubscriptionId);
        } catch (error) {
            console.error("Failed to cancel previous Razorpay subscription", error);
        }
    }
    current.status = "cancelled";
    current.cancelAtPeriodEnd = false;
    current.cancelledAt = new Date();
    current.cancelReason = reason || "Replaced by a new subscription";
    current.endedAt = new Date();
    current.set("pendingChange", undefined);
    await current.save();
    return current;
}

export function calculateUpgradeProration(currentPlan, targetPlan, subscription, now = new Date()) {
    const currentAmount = currentPlan?.amount?.value || 0;
    const targetAmount = targetPlan?.amount?.value || 0;
    const periodStart = subscription?.billing?.periodStart;
    const periodEnd = subscription?.billing?.periodEnd;
    const creditDelta = Math.max(0, (targetPlan.credits || 0) - (currentPlan.credits || 0));
    if (!periodStart || !periodEnd) {
        return {
            remainingDays: targetPlan.validity || 0,
            unusedAmount: 0,
            chargeAmount: Math.max(0, targetAmount - currentAmount),
            creditDelta
        };
    }
    const periodMs = Math.max(1, new Date(periodEnd) - new Date(periodStart));
    const remainingMs = Math.max(0, new Date(periodEnd) - now);
    const remainingRatio = Math.min(1, remainingMs / periodMs);
    const unusedAmount = Math.round(currentAmount * remainingRatio);
    const chargeAmount = Math.max(0, Math.round((targetAmount - currentAmount) * remainingRatio));
    return {
        remainingDays: Math.ceil(remainingMs / MS_PER_DAY),
        unusedAmount,
        chargeAmount,
        creditDelta
    };
}

export const applyGatewayBilling = (subscription, rzpSub) => {
    if (!rzpSub) return subscription;
    subscription.gatewayPayload = rzpSub;
    if (rzpSub.id) subscription.gatewaySubscriptionId = rzpSub.id;
    if (rzpSub.short_url) subscription.shortUrl = rzpSub.short_url;
    subscription.billing = {
        ...(subscription.billing || {}),
        periodStart: toUnixDate(rzpSub.current_start) || subscription.billing?.periodStart,
        periodEnd: toUnixDate(rzpSub.current_end) || subscription.billing?.periodEnd,
        nextChargeAt: toUnixDate(rzpSub.charge_at) || subscription.billing?.nextChargeAt,
        paidCount: rzpSub.paid_count ?? subscription.billing?.paidCount ?? 0,
        totalCount: rzpSub.total_count ?? subscription.billing?.totalCount
    };
    return subscription;
}

export function gql(message, code = "BAD_USER_INPUT") {
    return new GraphQLError(message, { extensions: { code } });
}

export async function loadPublicPlanByCode(code) {
    const plan = await Plan.findOne({ code, public: true, status: "active" });
    if (!plan) throw gql("Plan not found", "NOT_FOUND");
    return plan;
}

export async function populateSubscription(subscription) {
    await subscription.populate(["plan", "pendingChange.targetPlan"]);
    return subscription;
}

export async function setActiveSubscription(businessId, subscription, _plan, { planActive = true } = {}) {
    await Business.findByIdAndUpdate(businessId, {
        $set: {
            "credits.currentSubscription": subscription._id,
            "credits.active": planActive,
            "credits.carryForward": 0,
            "credits.lastUpdated": new Date(),
        },
    });
}

export function applyPlanFields(subscription, target) {
    subscription.plan = target._id;
    subscription.planCode = target.code;
    subscription.amount = target.amount;
    subscription.creditsPerCycle = target.credits;
    subscription.spendRatio = target.spendRatio;
    subscription.status = "active";
    subscription.cancelAtPeriodEnd = false;
    subscription.set("pendingChange", undefined);
    return subscription;
}

async function schedulePeriodEndReset(subscription) {
    const job = periodEndResetJob(subscription);
    if (!job.runAt) return;
    await axios.post("https://socketio.avakado.ai/api/cron", {
        id: job.idempotencyKey,
        name: job.name,
        scheduleType: "once",
        runAt: job.runAt,
        type: "http",
        url: "https://chat.avakado.ai/aux/trigger-reset-credits",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: job.body,
        enabled: true,
        miscIds: job.body,
    });
}

export async function changePaidPlan({ user, targetPlanCode, expectedKind }) {
    const subscription = await Subscription.findOne({
        business: user.business,
        status: { $in: [...CHANGEABLE_STATUSES] },
    }).populate("plan");
    if (!subscription) throw gql("No active subscription to change");
    if (!subscription.plan) throw gql("Current plan not found");
    const target = await loadPublicPlanByCode(targetPlanCode);
    if (!PAID_PLAN_TYPES.has(target.type)) throw gql("Target plan cannot be used for this change");
    if (!razorpayPlanId(target)) throw gql("Target plan is missing a Razorpay plan id");
    if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");
    const kind = planChangeKind(subscription.plan, target);
    if (kind !== expectedKind) {
        throw gql(expectedKind === "upgrade"
            ? "Target plan is not an upgrade. Use downgrade instead."
            : "Target plan is not a downgrade. Use upgrade instead.");
    }
    const business = await Business.findById(user.business).select("credits.balance");
    const apply = planChangeApplyAt({
        balance: business?.credits?.balance,
        periodEnd: subscription.billing?.periodEnd,
    });
    const rzpSub = await RazorPayService.updateSubscription(subscription.gatewaySubscriptionId, {
        plan_id: razorpayPlanId(target),
        schedule_change_at: apply,
        notes: {
            subscriptionId: subscription._id.toString(),
            businessId: user.business.toString(),
            planId: target._id.toString(),
            planCode: target.code,
            action: kind,
            apply,
        },
    });
    if (apply === "now") {
        applyPlanFields(subscription, target);
        applyGatewayBilling(subscription, rzpSub);
        await subscription.save();
        await setActiveSubscription(user.business, subscription, target, { planActive: true });
        return { subscription: await populateSubscription(subscription), checkout: null, apply };
    }
    subscription.pendingChange = {
        type: kind,
        targetPlan: target._id,
        targetPlanCode: target.code,
        applyAt: subscription.billing?.periodEnd || null,
    };
    if (kind === "downgrade") subscription.status = "pending_downgrade";
    applyGatewayBilling(subscription, rzpSub);
    await subscription.save();
    return { subscription: await populateSubscription(subscription), checkout: null, apply };
}

export async function upgradeSubscription({ targetPlanCode, user }) {
    return changePaidPlan({ user, targetPlanCode, expectedKind: "upgrade" });
}

export async function downgradeSubscription({ targetPlanCode, user }) {
    const result = await changePaidPlan({ user, targetPlanCode, expectedKind: "downgrade" });
    return result.subscription;
}

export async function cancelSubscription({ user, reason = "Cancelled by user" }) {
    const subscription = await Subscription.findOne({
        business: user.business,
        status: { $in: ["active", "authenticated", "pending_downgrade", "paused", "halted"] },
    });
    if (!subscription) throw gql("No cancellable subscription found");
    if (subscription.gateway === "razorpay" && subscription.gatewaySubscriptionId) {
        const rzpSub = await RazorPayService.cancelSubscription(subscription.gatewaySubscriptionId);
        applyGatewayBilling(subscription, rzpSub);
    }
    subscription.cancelAtPeriodEnd = true;
    subscription.status = "cancel_at_period_end";
    subscription.cancelledAt = new Date();
    subscription.cancelReason = reason;
    subscription.pendingChange = {
        type: "cancel",
        applyAt: subscription.billing?.periodEnd || null,
    };
    await subscription.save();
    try {
        await schedulePeriodEndReset(subscription);
    } catch (error) {
        console.error("Period-end reset cron was skipped", error?.response?.status || error.message);
    }
    return populateSubscription(subscription);
}

export async function pauseSubscription({ user }) {
    const subscription = await Subscription.findOne({
        business: user.business,
        status: { $in: ["active", "authenticated", "pending_downgrade"] },
    }).populate("plan");
    if (!subscription) throw gql("No active subscription to pause");
    if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");
    const rzpSub = await RazorPayService.pauseSubscription(subscription.gatewaySubscriptionId);
    subscription.status = "paused";
    applyGatewayBilling(subscription, rzpSub);
    await subscription.save();
    await Business.findByIdAndUpdate(user.business, { $set: { "credits.active": false, "credits.lastUpdated": new Date() } });
    return populateSubscription(subscription);
}

export async function resumeSubscription({ user }) {
    const subscription = await Subscription.findOne({
        business: user.business,
        status: { $in: ["paused", "cancel_at_period_end", "halted"] },
    }).populate("plan");
    if (!subscription) throw gql("No paused or cancelling subscription to resume");
    if (subscription.status === "cancel_at_period_end") {
        throw gql("A period-end cancellation cannot be undone on Razorpay. Start a new subscription after this period ends.");
    }
    if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");
    const rzpSub = await RazorPayService.resumeSubscription(subscription.gatewaySubscriptionId);
    subscription.status = "active";
    subscription.cancelAtPeriodEnd = false;
    applyGatewayBilling(subscription, rzpSub);
    await subscription.save();
    await setActiveSubscription(user.business, subscription, subscription.plan, { planActive: true });
    return populateSubscription(subscription);
}
