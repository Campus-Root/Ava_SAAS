import { NodeModel } from '@avakado.ai/schemas';
import { Workflow } from '@avakado.ai/schemas';
import { validateLoops } from "../../utils/workflowHelpers.js";
import { GraphQLError } from "graphql";

export const workflowResolvers = {
    Query: {
        async fetchWorkflows(_, { id, limit = 10, page = 1 }, context, info) {
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            const workflows = await Workflow.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
            const totalDocuments = await Workflow.countDocuments(filter);
            return { data: workflows, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        async fetchInbuiltNodes(_, { label, type, templateType, id, limit = 10, page = 1 }, context, info) {
            const filter = {};
            if (label) filter['meta.label'] = label;
            if (type) filter.type = type;
            if (id) filter._id = id;
            const nodes = await NodeModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
            const totalDocuments = await NodeModel.countDocuments(filter);
            return { data: nodes, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
    },
    Mutation: {
        async createWorkflow(_, { name, nodes, connections }, context, info) {
            let WorkflowTemplate = { name, nodes, connections, business: context.user.business, createdBy: context.user._id }
            if (!name || !nodes || !connections) throw new GraphQLError("Name, nodes, and connections are required", { extensions: { code: "BAD_USER_INPUT" } });
            if (validateLoops(WorkflowTemplate)) throw new GraphQLError("Workflow contains a loop. Cycles are not allowed.", { extensions: { code: "BAD_USER_INPUT" } });
            const workflow = await Workflow.create(WorkflowTemplate);
            return workflow;
        },
        async updateWorkflow(_, { id, name, nodes, connections }, context, info) {
            let WorkflowTemplate = { name, nodes, connections, business: context.user.business, createdBy: context.user._id }
            if (!name || !nodes || !connections) throw new GraphQLError("Name, nodes, and connections are required", { extensions: { code: "BAD_USER_INPUT" } });
            if (validateLoops(WorkflowTemplate)) throw new GraphQLError("Workflow contains a loop. Cycles are not allowed.", { extensions: { code: "BAD_USER_INPUT" } });
            const workflow = await Workflow.findByIdAndUpdate(id, WorkflowTemplate, { new: true });
            return workflow;
        },
        async deleteWorkflow(_, { id }, context, info) {
            const workflow = await Workflow.findByIdAndDelete(id);
            if (!workflow) throw new GraphQLError("Workflow not found", { extensions: { code: "BAD_USER_INPUT" } });
            return true;
        },
        async testWorkflowNode(_, { input, node }, context, info) {
            const { handlerFunction, errorFunction, config, inputMapper } = node.core
            const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
            const inputHandler = new AsyncFunction("input", "config", `"use strict"; ${inputMapper}`);
            const nodeInput = await inputHandler(input, config);
            try {
                const handler = new AsyncFunction("input", "config", `"use strict"; ${handlerFunction}`);
                return await handler(nodeInput, config);
            }
            catch (error) {
                const errorHandler = new AsyncFunction("input", "config", "error", `"use strict"; ${errorFunction}`);
                return await errorHandler(input, config, error);
            }
        },
        async createInbuiltNode(_, { id, ports, core, meta }, context, info) {
            let InbuiltNodeTemplate = { id, ports, core, meta, createdBy: context.user._id }
            const inbuiltNode = await NodeModel.create(InbuiltNodeTemplate);
            return inbuiltNode;
        },
        async updateInbuiltNode(_, { id, ports, core, meta }, context, info) {
            let InbuiltNodeTemplate = { ports, core, meta }
            const inbuiltNode = await NodeModel.findByIdAndUpdate(id, InbuiltNodeTemplate, { new: true });
            return inbuiltNode;
        },
        async deleteInbuiltNode(_, { id }, context, info) {
            const inbuiltNode = await NodeModel.findByIdAndDelete(id);
            return inbuiltNode;
        },

    }
};