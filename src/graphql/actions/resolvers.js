import { Action } from '@avakado.ai/schemas';
import graphqlFields from 'graphql-fields';
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { AgentModel } from '@avakado.ai/schemas';
import { Business } from "@avakado.ai/schemas";

export const actionResolvers = {
    Query: {
        actions: async (_, { limit = 10, page = 1, id }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            const actions = await Action.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(rootFields);
            const totalDocuments = await Action.countDocuments(filter);
            if (populateFields?.business) await Business.populate(actions, { path: 'business', select: populateFields.business });
            return { data: actions, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        }
    },
    Mutation: {
        createAction: async (_, { action }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const newAction = await Action.create({ ...action, business: context.user.business })
            await Business.populate(newAction, { path: 'business', select: nested.business });
            return newAction;
        },
        testAction: async (_, { id }, context) => {
            // const action = await Action.findById(actionId);
            // const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
            // const mainFunction = new AsyncFunction("input", action.functionString);
            // const result = await mainFunction(parameters);
            // return result;
            return { message: "Test action not implemented" };
        },
        updateAction: async (_, { id, action }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const updatedAction = await Action.findByIdAndUpdate(id, action, { new: true })
            await Business.populate(updatedAction, { path: 'business', select: nested.business });
            return updatedAction;
        },
        deleteAction: async (_, { id }, context) => {
            await Promise.all([Action.findByIdAndDelete(id), AgentModel.updateMany({ actions: id, business: context.user.business }, { $pull: { actions: id } })]);
            return true;
        }
    }
}