import { Plan } from "../../models/Plans.js";
import { Subscription } from "../../models/Subscriptions.js";
import graphqlFields from "graphql-fields";
import { getSelectFields } from '../../utils/graphqlTools.js';
import { GraphQLError } from "graphql";
import {
    // cancelSubscription as cancelSubscriptionService,
    // downgradeSubscription as downgradeSubscriptionService,
    getCurrentSubscription,
    getSubscriptionById,
    getSubscriptionHistory,
    // pauseSubscription as pauseSubscriptionService,
    // purchaseTopup as purchaseTopupService,
    // resumeSubscription as resumeSubscriptionService,
    startSubscription as startSubscriptionService,
    // upgradeSubscription as upgradeSubscriptionService
} from "../../services/subscriptionService.js";

const gql = (message, code = "BAD_USER_INPUT") => new GraphQLError(message, { extensions: { code } });

const compactInput = (input = {}) => {
    const update = {};
    for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) update[key] = value;
    }
    return update;
};

const handlePlanWriteError = (error) => {
    if (error?.code === 11000) throw gql("Plan code already exists");
    if (error?.name === "ValidationError") throw gql(error.message);
    throw error;
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
            const filter = {};
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
        async currentSubscription(_, __, context) {
            return getCurrentSubscription(context.user.business);
        },
        async subscriptionHistory(_, { page = 1, limit = 10 }, context) {
            return getSubscriptionHistory(context.user.business, { page, limit });
        },
        async subscription(_, { id }, context) {
            return getSubscriptionById(context.user.business, id);
        }
    },
    Mutation: {
        async createAVAPlan(_, { input }, context, info) {
            if (!input?.name) throw gql("Plan name is required");
            if (!input?.type) throw gql("Plan type is required");
            if (!input?.code) throw gql("Plan code is required");
            try {
                const plan = await Plan.create(compactInput(input));
                await populateAllowedTopUps(plan, info);
                return plan;
            } catch (error) {
                handlePlanWriteError(error);
            }
        },
        async updateAVAPlan(_, { id, input }, context, info) {
            try {
                const plan = await Plan.findByIdAndUpdate(id, compactInput(input), { new: true, runValidators: true });
                if (!plan) throw gql("Plan not found", "NOT_FOUND");
                await populateAllowedTopUps(plan, info);
                return plan;
            } catch (error) {
                if (error instanceof GraphQLError) throw error;
                handlePlanWriteError(error);
            }
        },
        async deleteAVAPlan(_, { id }) {
            const inUse = await Subscription.countDocuments({ plan: id });
            if (inUse) throw gql("Cannot delete a plan that is used by subscriptions");
            const deleted = await Plan.findByIdAndDelete(id);
            if (!deleted) throw gql("Plan not found", "NOT_FOUND");
            return true;
        },
        async startSubscription(_, { planId }, context) {
            return startSubscriptionService({ planId, user: context.user });
        },
        async upgradeSubscription(_, { targetPlanCode }, context) {
            // return upgradeSubscriptionService({ targetPlanCode, user: context.user });
        },
        async downgradeSubscription(_, { targetPlanCode }, context) {
            // return downgradeSubscriptionService({ targetPlanCode, user: context.user });
        },
        async cancelSubscription(_, __, context) {
            // return cancelSubscriptionService({ user: context.user });
        },
        async pauseSubscription(_, __, context) {
            // return pauseSubscriptionService({ user: context.user });
        },
        async resumeSubscription(_, __, context) {
            // return resumeSubscriptionService({ user: context.user });
        },
        async purchaseTopup(_, { code }, context) {
            // return purchaseTopupService({ code, user: context.user });
        }
    }
};
