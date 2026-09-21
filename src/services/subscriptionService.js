import { CURRENT_SUBSCRIPTION_STATUSES, Subscription } from "@avakado.ai/schemas";
import { RazorPayService } from "./razorPayService.js";

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

// export async function upgradeSubscription({ targetPlanCode, user }) {
//     const subscription = await Subscription.findOne({
//         business: user.business,
//         status: { $in: ["active", "authenticated", "pending_downgrade", "cancel_at_period_end"] }
//     }).populate("plan");
//     if (!subscription) throw gql("No active subscription to upgrade");
//     if (!subscription.plan) throw gql("Current plan not found");

//     const target = await loadPublicPlanByCode(targetPlanCode);
//     if (!PAID_PLAN_TYPES.has(target.type)) throw gql("Target plan cannot be used for upgrade");
//     if ((target.amount?.value || 0) <= (subscription.plan.amount?.value || 0)) {
//         throw gql("Target plan is not an upgrade. Use downgrade instead.");
//     }
//     if (!razorpayPlanId(target)) throw gql("Target plan is missing a Razorpay plan id");
//     if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");

//     const proration = calculateUpgradeProration(subscription.plan, target, subscription);
//     subscription.pendingChange = {
//         type: "upgrade",
//         targetPlan: target._id,
//         targetPlanCode: target.code,
//         applyAt: new Date(),
//         chargeAmount: proration.chargeAmount,
//         creditDelta: proration.creditDelta
//     };

//     if (proration.chargeAmount < 1) {
//         await applyPaidUpgrade({ subscription, target });
//         return { subscription: await populateSubscription(subscription), checkout: null, proration };
//     }

//     const receiptId = `upg${subscription._id.toString().slice(-8)}${Date.now().toString().slice(-8)}`;
//     const order = await RazorPayService.createOrder({
//         amount: proration.chargeAmount,
//         currency: target.amount?.currency || "INR",
//         receiptId,
//         notes: {
//             subscriptionId: subscription._id.toString(),
//             businessId: user.business.toString(),
//             planId: target._id.toString(),
//             planCode: target.code,
//             action: "upgrade",
//             creditDelta: String(proration.creditDelta)
//         }
//     });
//     subscription.pendingChange.orderId = order.id;
//     await subscription.save();
//     await Payment.create({
//         business: user.business,
//         subscription: subscription._id,
//         gateway: "razorpay",
//         gatewayReference: { orderId: order.id, action: "upgrade", planId: target._id.toString() },
//         status: "authorized"
//     });

//     return {
//         subscription: await populateSubscription(subscription),
//         checkout: checkoutOrder(order, proration.chargeAmount, target.amount?.currency),
//         proration
//     };
// }

async function applyPaidUpgrade({ subscription, target }) {
    const creditDelta = Math.max(0, (target.credits || 0) - (subscription.creditsPerCycle || 0));
    const rzpSub = await RazorPayService.updateSubscription(subscription.gatewaySubscriptionId, {
        plan_id: razorpayPlanId(target),
        schedule_change_at: "now",
        notes: {
            subscriptionId: subscription._id.toString(),
            businessId: subscription.business.toString(),
            planId: target._id.toString(),
            planCode: target.code,
            action: "upgrade",
            creditDelta: String(creditDelta)
        }
    });
    subscription.plan = target._id;
    subscription.planCode = target.code;
    subscription.amount = target.amount;
    subscription.creditsPerCycle = target.credits;
    subscription.spendRatio = target.spendRatio;
    subscription.status = "active";
    subscription.cancelAtPeriodEnd = false;
    subscription.set("pendingChange", undefined);
    applyGatewayBilling(subscription, rzpSub);
    await subscription.save();
    await setActiveSubscription(subscription.business, subscription, target, { planActive: true });
}

// export async function downgradeSubscription({ targetPlanCode, user }) {
//     const subscription = await Subscription.findOne({
//         business: user.business,
//         status: { $in: ["active", "authenticated", "pending_downgrade"] }
//     }).populate("plan");
//     if (!subscription) throw gql("No active subscription to downgrade");

//     const target = await loadPublicPlanByCode(targetPlanCode);
//     if (!PAID_PLAN_TYPES.has(target.type)) throw gql("Target plan cannot be used for downgrade");
//     if ((target.amount?.value || 0) >= (subscription.plan.amount?.value || 0)) {
//         throw gql("Target plan is not a downgrade. Use upgrade instead.");
//     }
//     if (!razorpayPlanId(target)) throw gql("Target plan is missing a Razorpay plan id");
//     if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");

//     const rzpSub = await RazorPayService.updateSubscription(subscription.gatewaySubscriptionId, {
//         plan_id: razorpayPlanId(target),
//         schedule_change_at: "cycle_end",
//         notes: {
//             subscriptionId: subscription._id.toString(),
//             businessId: user.business.toString(),
//             planId: target._id.toString(),
//             planCode: target.code,
//             action: "downgrade"
//         }
//     });
//     subscription.pendingChange = {
//         type: "downgrade",
//         targetPlan: target._id,
//         targetPlanCode: target.code,
//         applyAt: subscription.billing?.periodEnd || null
//     };
//     subscription.status = "pending_downgrade";
//     applyGatewayBilling(subscription, rzpSub);
//     await subscription.save();
//     return populateSubscription(subscription);
// }

// export async function cancelSubscription({ user, reason = "Cancelled by user" }) {
//     const subscription = await Subscription.findOne({
//         business: user.business,
//         status: { $in: ["active", "authenticated", "pending_downgrade", "paused", "halted"] }
//     });
//     if (!subscription) throw gql("No cancellable subscription found");

//     if (subscription.gateway === "razorpay" && subscription.gatewaySubscriptionId) {
//         const rzpSub = await RazorPayService.cancelSubscription(subscription.gatewaySubscriptionId);
//         applyGatewayBilling(subscription, rzpSub);
//     }
//     subscription.cancelAtPeriodEnd = true;
//     subscription.status = "cancel_at_period_end";
//     subscription.cancelledAt = new Date();
//     subscription.cancelReason = reason;
//     subscription.pendingChange = {
//         type: "cancel",
//         applyAt: subscription.billing?.periodEnd || null
//     };
//     await subscription.save();
//     return populateSubscription(subscription);
// }

// export async function pauseSubscription({ user }) {
//     const subscription = await Subscription.findOne({
//         business: user.business,
//         status: { $in: ["active", "authenticated", "pending_downgrade"] }
//     }).populate("plan");
//     if (!subscription) throw gql("No active subscription to pause");
//     if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");
//     const rzpSub = await RazorPayService.pauseSubscription(subscription.gatewaySubscriptionId);
//     subscription.status = "paused";
//     applyGatewayBilling(subscription, rzpSub);
//     await subscription.save();
//     return populateSubscription(subscription);
// }

// export async function resumeSubscription({ user }) {
//     const subscription = await Subscription.findOne({
//         business: user.business,
//         status: { $in: ["paused", "cancel_at_period_end", "halted"] }
//     }).populate("plan");
//     if (!subscription) throw gql("No paused or cancelling subscription to resume");

//     if (subscription.status === "cancel_at_period_end") {
//         throw gql("A period-end cancellation cannot be undone on Razorpay. Start a new subscription after this period ends.");
//     }
//     if (!subscription.gatewaySubscriptionId) throw gql("Subscription is not linked to Razorpay");

//     const rzpSub = await RazorPayService.resumeSubscription(subscription.gatewaySubscriptionId);
//     subscription.status = "active";
//     subscription.cancelAtPeriodEnd = false;
//     applyGatewayBilling(subscription, rzpSub);
//     await subscription.save();
//     await setActiveSubscription(user.business, subscription, subscription.plan, { planActive: true });
//     return populateSubscription(subscription);
// }

// export async function purchaseTopup({ code, user }) {
//     const receiptId = `tp${user.business.toString().slice(-8)}${Date.now().toString().slice(-8)}`;
//     const order = await RazorPayService.createOrder({
//         amount: plan.amount.value,
//         currency: plan.amount.currency || "INR",
//         receiptId,
//         notes: {
//             businessId: user.business.toString(),
//             planId: plan._id.toString(),
//             planCode: plan.code,
//             subscriptionId: current._id.toString(),
//             action: "topup",
//             credits: String(plan.credits || 0)
//         }
//     });

//     });
//     return {
//         subscription: current,
//         checkout: checkoutOrder(order, plan.amount.value, plan.amount.currency),
//         proration: null
//     };
// }
