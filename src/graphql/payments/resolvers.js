import { Plan } from "../../models/Plans.js";
import { Subscription } from "../../models/Subscriptions.js";
import { Payment } from "../../models/Payments.js";
import graphqlFields from "graphql-fields";
import { getSelectFields } from '../../utils/graphqlTools.js';
import { GraphQLError } from "graphql";
import {
    applyGatewayBilling, checkoutOrder, checkoutSubscription, razorpayPlanId, supersedeCurrent,
    // cancelSubscription as cancelSubscriptionService,
    // downgradeSubscription as downgradeSubscriptionService,
    // pauseSubscription as pauseSubscriptionService,
    // resumeSubscription as resumeSubscriptionService,
    // upgradeSubscription as upgradeSubscriptionService
} from "../../services/subscriptionService.js";
import { Business } from "../../models/Business.js";
import { RazorPayService } from "../../services/razorPayService.js";
import { Chat } from "openai/resources/index.mjs";


const compactInput = (input = {}) => {
    const update = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) update[key] = value;
    }
    return update;
};


const populateAllowedTopUps = async (plans, info) => {
    const requestedFields = graphqlFields(info, {}, { processArguments: false });
    const source = requestedFields.data || requestedFields;
    const { populateFields } = getSelectFields(source);
    if (!populateFields?.allowedTopUps) return plans;
    await Plan.populate(plans, { path: "allowedTopUps", select: populateFields.allowedTopUps });
    return plans;
};

export const paymentResolvers = {
    Query: {
        async fetchPlans(_, { code, name, type, status, id }, context, info) {
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            if (code) filter.code = code;
            if (name) filter.name = { $regex: name, $options: "i" };
            if (status) filter.status = status;
            if (type) filter.type = type;
            const plans = await Plan.find(filter).sort({ createdAt: -1 });
            await populateAllowedTopUps(plans, info);
            return plans;
        },
        async fetchPublicPlans(_, { code, name, id, status = "active", type }, context, info) {
            const filter = { public: true };
            if (id) filter._id = id;
            if (code) filter.code = code;
            if (name) filter.name = { $regex: name, $options: "i" };
            if (status) filter.status = status;
            if (type) filter.type = type;
            const plans = await Plan.find(filter).sort({ createdAt: -1 });
            await populateAllowedTopUps(plans, info);
            return plans;
        },
        async subscriptionHistory(_, { page = 1, limit = 10, id, planId, status, startedAt, endedAt, cancelledAt }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            let filter = { business: context.user.business };
            if (id) filter._id = id;
            if (planId) filter.plan = planId;
            if (status) filter.status = status;
            if (startedAt) filter.startedAt = { $gte: startedAt };
            if (endedAt) filter.endedAt = { $lte: endedAt };
            if (cancelledAt) filter.cancelledAt = { $lte: cancelledAt };
            const subscriptions = await Subscription.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
            if (populateFields?.plan) await Plan.populate(subscriptions, { path: "plan", select: populateFields.plan });
            if (populateFields?.pendingChange) await Subscription.populate(subscriptions, { path: "pendingChange.targetPlan", select: populateFields.pendingChange });
            const totalDocuments = await Subscription.countDocuments({ business: context.user.business });
            return {
                data: subscriptions,
                metaData: {
                    page,
                    limit,
                    totalPages: Math.ceil(totalDocuments / limit),
                    totalDocuments
                }
            };
        }
    },
    Mutation: {
        async createAVAPlan(_, { input }, context, info) {
            if (!input?.name) throw GraphQLError("Plan name is required", { extensions: { code: "BAD_USER_INPUT" } });
            if (!input?.type) throw GraphQLError("Plan type is required", { extensions: { code: "BAD_USER_INPUT" } });
            if (!input?.code) throw GraphQLError("Plan code is required", { extensions: { code: "BAD_USER_INPUT" } });
            try {
                const plan = await Plan.create(compactInput(input));
                await populateAllowedTopUps(plan, info);
                return plan;
            } catch (error) {
                throw GraphQLError(error.message, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
            }
        },
        async updateAVAPlan(_, { id, input }, context, info) {
            try {
                const plan = await Plan.findByIdAndUpdate(id, compactInput(input), { new: true, runValidators: true });
                if (!plan) throw GraphQLError("Plan not found", { extensions: { code: "NOT_FOUND" } });
                await populateAllowedTopUps(plan, info);
                return plan;
            } catch (error) {
                if (error instanceof GraphQLError) throw error;
                throw GraphQLError(error.message, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
            }
        },
        async deleteAVAPlan(_, { id }) {
            const inUse = await Subscription.countDocuments({ plan: id });
            if (inUse) throw GraphQLError("Cannot delete a plan that is used by subscriptions", { extensions: { code: "BAD_USER_INPUT" } });
            const deleted = await Plan.findByIdAndDelete(id);
            if (!deleted) throw GraphQLError("Plan not found", { extensions: { code: "NOT_FOUND" } });
            return true;
        },
        async startFreeTrail(_, __, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const business = await Business.findById(context.user.business).select("credits.freeTrailClaimed credits.freeTrailExpiry credits.currentSubscription");
            if (business.credits.freeTrailClaimed) throw GraphQLError("Free trial already claimed", { extensions: { code: "BAD_USER_INPUT" } });
            if (business.credits.freeTrailExpiry && business.credits.freeTrailExpiry > new Date()) throw GraphQLError("Free trial not expired", { extensions: { code: "BAD_USER_INPUT" } });
            if (business.credits.currentSubscription) throw GraphQLError("An active subscription already exists. Use upgrade or downgrade.", { extensions: { code: "BAD_USER_INPUT" } });
            await business.updateOne({ credits: { freeTrailClaimed: true, active: true, balance: 3000, lastUpdated: new Date(), freeTrailExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
            try {
                console.log("seting up cron job for free trail reset");
                const response = await axios.post("https://socketio.avakado.ai/api/cron", {
                    "id": `free_trail_reset_${business._id}`,
                    "name": "Free trail reset",
                    "scheduleType": "once",
                    "runAt": business.credits.freeTrailExpiry,
                    "type": "http",
                    "url": "https://chat.avakado.ai/aux/trigger-reset-credits",
                    "method": "POST",
                    "headers": { "Content-Type": "application/json" },
                    "body": {
                        businessId: business._id,
                        idempotencyKey: `free_trail_reset_${business._id}`,
                        note: "Free trail reset",
                        meta: {
                            businessId: business._id,
                            freeTrailClaimed: business.credits.freeTrailClaimed,
                            freeTrailExpiry: business.credits.freeTrailExpiry
                        }
                    },
                    "enabled": true,
                    "miscIds": {
                        businessId: business._id,
                        freeTrailClaimed: business.credits.freeTrailClaimed,
                        freeTrailExpiry: business.credits.freeTrailExpiry
                    }
                })
                console.log("cron job set up for free trail reset", response.data);
            } catch (error) {
                console.error(error);
                throw GraphQLError("Failed to set up cron job for free trail reset", { extensions: { code: "INTERNAL_SERVER_ERROR" } });
            }
            return { credits: business.credits };
        },
        async startSubscription(_, { planId }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const plan = await Plan.findById(planId);
            if (!plan) throw GraphQLError("Plan not found", { extensions: { code: "NOT_FOUND" } });
            if (plan.type === "TOPUP") throw GraphQLError("Use purchaseTopup for top-up plans", { extensions: { code: "BAD_USER_INPUT" } });
            // check if free trail is active
            const business = await Business.findById(context.user.business).select("credits.freeTrailClaimed credits.freeTrailExpiry credits.currentSubscription");
            await axios.post(`https://socketio.avakado.ai/api/cron/${`free_trail_reset_${business._id}`}/run`)
            if (business.credits.freeTrailExpiry && business.credits.freeTrailExpiry > new Date()) await Business.findByIdAndUpdate(context.user.business, { $set: { "credits.freeTrailClaimed": true, "credits.freeTrailExpiry": new Date(), "credits.lastUpdated": new Date() } });
            const current = await Subscription.findOne({ business: context.user.business, status: { $in: CURRENT_SUBSCRIPTION_STATUSES } }).populate("plan");
            if (current && PAID_PLAN_TYPES.has(current.plan?.type) && !["created", "pending_payment"].includes(current.status)) throw GraphQLError("An active paid subscription already exists. Use upgrade or downgrade.", { extensions: { code: "BAD_USER_INPUT" } });
            if (!razorpayPlanId(plan)) throw GraphQLError("Plan is missing a Razorpay plan id", { extensions: { code: "BAD_USER_INPUT" } });
            if (current) await supersedeCurrent(context.user.business, { reason: `Replaced by ${plan.code}` });
            let subscription, rzpSub;
            try {
                subscription = await Subscription.create({ business: context.user.business, createdBy: context.user._id, plan: plan._id, planCode: plan.code, gateway: "razorpay", status: "pending_payment", amount: plan.amount, creditsPerCycle: plan.credits, spendRatio: plan.spendRatio });
                rzpSub = await RazorPayService.createSubscription({ plan_id: razorpayPlanId(plan), notes: { subscriptionId: subscription._id.toString(), businessId: context.user.business.toString(), planId: plan._id.toString(), planCode: plan.code, action: "start", credits: String(plan.credits || 0) } });
                applyGatewayBilling(subscription, rzpSub);
                await subscription.save();
            } catch (error) {
                console.error(error);
                if (subscription) await Subscription.findByIdAndDelete(subscription._id);
                if (rzpSub) await RazorPayService.cancelSubscription(rzpSub.id);
                throw GraphQLError(error.message, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
            }
            if (populateFields?.plan) await Plan.populate(subscription, { path: "plan", select: populateFields.plan });
            if (populateFields?.pendingChange) await Subscription.populate(subscription, { path: "pendingChange.targetPlan", select: populateFields.pendingChange });
            return { subscription: subscription, checkout: checkoutSubscription(rzpSub, plan.amount) };
        },
        async purchaseTopup(_, { planId }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const plan = await Plan.findById(planId);
            if (!plan) throw GraphQLError("Plan not found", { extensions: { code: "NOT_FOUND" } });
            if (plan.type !== "TOPUP") throw GraphQLError("Plan is not a top-up", { extensions: { code: "BAD_USER_INPUT" } });
            const { currentSubscription } = await Business.findById(context.user.business).select("credits.currentSubscription");
            await Plan.populate(currentSubscription.plan);
            if (!currentSubscription.plan.allowedTopUps.includes(planId)) throw GraphQLError("Plan is not allowed for this subscription", { extensions: { code: "BAD_USER_INPUT" } });
            const receiptId = `tp${user.business.toString().slice(-8)}${Date.now().toString().slice(-8)}`;
            const rzpOrder = await RazorPayService.createOrder({
                amount: plan.amount.value,
                currency: plan.amount.currency || "INR",
                receiptId,
                notes: {
                    businessId: user.business.toString(),
                    planId: plan._id.toString(),
                    planCode: plan.code,
                    subscriptionId: current._id.toString(),
                    action: "topup",
                    credits: String(plan.credits || 0)
                }
            });
            const payment = await Payment.create({
                business: user.business,
                subscription: currentSubscription._id,
                gateway: "razorpay",
                gatewayReference: { orderId: rzpOrder.id, action: "topup", planId: plan._id.toString() },
                status: "authorized",
                notes: {
                    planId: plan._id.toString(),
                    planCode: plan.code,
                    action: "topup",
                    credits: String(plan.credits || 0)
                }
            })

            return { payment: payment, checkout: checkoutOrder(rzpOrder, plan.amount) };
        },
        // async upgradeSubscription(_, { targetPlanId }, context) {
        //     // return upgradeSubscriptionService({ targetPlanCode, user: context.user });
        // },
        // async downgradeSubscription(_, { targetPlanCode }, context) {
        //     // return downgradeSubscriptionService({ targetPlanCode, user: context.user });
        // },
        // async cancelSubscription(_, __, context) {
        //     // return cancelSubscriptionService({ user: context.user });
        // },
        // async pauseSubscription(_, __, context) {
        //     // return pauseSubscriptionService({ user: context.user });
        // },
        // async resumeSubscription(_, __, context) {
        //     // return resumeSubscriptionService({ user: context.user });
        // },

    }
};
