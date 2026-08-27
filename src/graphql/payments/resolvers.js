import { Plan } from "../../models/Plans.js";
import graphqlFields from "graphql-fields";
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { RazorPayService } from "../../services/razorPayService.js";
import { GraphQLError } from "graphql";
import { Business } from "../../models/Business.js";
import { Subscription } from "../../models/Subscriptions.js";
import { postTask } from "../../services/agenda.js";
export const paymentResolvers = {
    Query: {
        async fetchPlans(_, { code, name, type, status = 'active', id }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields);
            const filter = {};
            if (id) filter._id = id;
            if (code) filter.code = code;
            if (name) filter.name = name;
            if (status) filter.status = status;
            if (type) filter.type = type;
            const Plans = await Plan.find(filter).sort({ createdAt: -1 }).populate({ path: "allowedTopUps", select: rootFields });
            return Plans;
        },
        async fetchPublicPlans(_, { code, name, id, status = 'active', type }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields);
            const filter = { public: true };
            if (id) filter._id = id;
            if (code) filter.code = code;
            if (name) filter.name = name;
            if (status) filter.status = status;
            if (type) filter.type = type;
            const Plans = await Plan.find(filter).sort({ createdAt: -1 }).populate({ path: "allowedTopUps", select: rootFields });
            return Plans;
        },
        async fetchSubscription(_, { id }, context, info) {
            const subscription = await Subscription.findById(id).select('plan gatewayReference metadata').populate('plan', 'type');
            if (!subscription) throw new GraphQLError("Subscription not found", { extensions: { code: "BAD_USER_INPUT" } });
            if (subscription.gateway === "razorpay") {
                let ref = await RazorPayService.fetchSubscriptionById(subscription.gatewayReference.id);
                if (ref.status !== subscription.metadata.status) {
                    subscription.gatewayReference = ref
                    subscription.metadata.expiresAt = new Date(subscription.gatewayReference.current_end * 1000);
                    subscription.metadata.status = subscription.gatewayReference.status;
                    await subscription.save();
                }
            }
            return subscription;
        },
        async fetchUsageLogs(_, { type, startDate, endDate }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields);
            let filter = { business: context.user.business };
            if (type) filter.type = type;
            if (startDate) filter.createdAt = { $gte: startDate };
            if (endDate) filter.createdAt = { $lte: endDate };
            const usageLogs = await UsageLog.find(filter).sort({ createdAt: -1 }).populate({ path: "references.id" });
            return usageLogs;
        }
    },
    Mutation: {
        async createAVAPlan(_, { input }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const plan = await Plan.create(input);
            await plan.populate(plan, { path: "allowedTopUps", select: projection });
            return plan;
        },
        async updateAVAPlan(_, { id, input }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const plan = await Plan.findByIdAndUpdate(id, input, { new: true }).populate({ path: "allowedTopUps", select: projection });
            return plan;
        },
        async deleteAVAPlan(_, { id }, context, info) {
            await Plan.findByIdAndDelete(id);
            return true;
        },
        async startPayment(_, { planId, gateway = "razorpay", paymentType = "subscription", startDate = null }, context, info) {
            const [plan, business] = await Promise.all([
                Plan.findById(planId).select('type amount validity credits spendRatio paymentGateWay'),
                Business.findById(context.user.business).select('credits freeTrailClaimed')
            ]);
            if (!plan) throw new GraphQLError("Plan not found", { extensions: { code: "BAD_USER_INPUT" } });
            const existingPlan = await Subscription.findById(business?.credits?.activePlan).select('plan metadata gateway gatewayReference inActive').populate('plan', 'type');
            if (existingPlan && !existingPlan.inActive) {
                console.log(existingPlan.inActive)
                if (existingPlan.plan.type !== "FREE") {
                    switch (existingPlan.gateway) {
                        case "razorpay":
                            await RazorPayService.cancelSubscription(existingPlan.gatewayReference.id);
                            break;
                        default:
                            throw new GraphQLError("Invalid gateway", { extensions: { code: "BAD_USER_INPUT" } });
                    }
                }
                else if (plan.type === "FREE") {
                    throw new GraphQLError("You already have a free plan that expires at " + existingPlan.metadata.expiresAt, { extensions: { code: "BAD_USER_INPUT" } });
                }
                if (!startDate) startDate = new Date(existingPlan.metadata.expiresAt);
                existingPlan.metadata.cancelledAt = new Date()
                existingPlan.metadata.cancelledReason = "Upgraded to a new plan"
                existingPlan.inActive = true;
                await Promise.all([existingPlan.save()]);
            }
            switch (plan.type) {
                case "FREE":
                    {
                        if (business?.freeTrailClaimed) throw new GraphQLError("Free trail already claimed, Contact support to upgrade your plan", { extensions: { code: "BAD_USER_INPUT" } });
                        const subscription = await Subscription.create({
                            business: context.user.business,
                            createdBy: context.user._id,
                            plan: planId,
                            gateway,
                            type: paymentType,
                            events: {
                                activated: new Date()
                            },
                            metadata: {
                                expiresAt: new Date(Date.now() + plan.validity * 24 * 60 * 60 * 1000)
                            }
                        });
                        await postTask("reset-credits", { id: subscription._id.toString(), businessId: context.user.business.toString(), planId: planId.toString() }, new Date(subscription.metadata.expiresAt).toISOString());
                        await business.UpdateCredits({ operation: 'set', llmCredits: plan.credits.llm, knowledgeCredits: plan.credits.knowledge, miscellaneousCredits: plan.credits.miscellaneous, spendRatio: plan.spendRatio, isPlanInActive: false, activePlan: subscription._id });
                        business.freeTrailClaimed = true;
                        await business.save()
                        return subscription;
                    }
                case "TEST":
                case "BASE":
                    {
                        const subscription = await Subscription.create({ business: context.user.business, createdBy: context.user._id, plan: planId, gateway, type: paymentType, amount: plan.amount, metadata: { expiresAt: new Date(Date.now() + plan.validity * 24 * 60 * 60 * 1000) } });
                        switch (gateway) {
                            case "razorpay":
                                subscription.gatewayReference = await RazorPayService.createSubscription({ plan_id: plan.paymentGateWay.razorpay.plan_id, notes: { subscriptionId: subscription._id.toString(), businessId: context.user.business.toString(), planId: planId.toString() }, startDate: startDate });
                                subscription.credits.lastGrantedCycle = subscription.gatewayReference.paid_count;
                                subscription.credits.lastGrantedAt = new Date();
                                break;
                            default:
                                throw new GraphQLError("Invalid gateway", { extensions: { code: "BAD_USER_INPUT" } });
                        }
                        await subscription.save()
                        return subscription;
                    }
            }
        },
        async cancelSubscription(_, { id }, context, info) {
            const subscription = await Subscription.findById(id);
            if (!subscription) throw new GraphQLError("Subscription not found", { extensions: { code: "BAD_USER_INPUT" } });
            subscription.metadata.cancelledAt = new Date();
            subscription.metadata.cancelledReason = "Cancelled by user";
            subscription.metadata.inActive = true;
            subscription.metadata.status = "cancelled";
            await subscription.save();
            await RazorPayService.cancelSubscription(subscription.gatewayReference.id);
            return true;
        }
    }
};