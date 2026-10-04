import { TriggerTemplate } from '@avakado.ai/schemas';
import { Workflow } from '@avakado.ai/schemas';
import { GraphQLError } from "graphql";

export const workflowResolvers = {
    Query: {
        async fetchTriggerTemplates(_, { limit = 10, page = 1, name, type }, context, info) {
            const filter = {};
            if (name) filter.name = { $regex: name, $options: "i" };
            if (type) filter.type = { $regex: type, $options: "i" };
            const triggerTemplates = await TriggerTemplate.find(filter).skip((page - 1) * limit).limit(limit);
            const totalDocuments = await TriggerTemplate.countDocuments(filter);
            return { data: triggerTemplates, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        async fetchWorkflows(_, { id, trigger, status, limit = 10, page = 1, sort = { updatedAt: -1 } }, context, info) {
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            if (trigger) filter.trigger = { $regex: trigger, $options: "i" };;
            if (status) filter.status = status;
            const workflows = await Workflow.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
            const totalDocuments = await Workflow.countDocuments(filter);
            return { data: workflows, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        }
    },
    Mutation: {
        async createWorkflow(_, { name, trigger, task }, context, info) {
            // let WorkflowTemplate = { name, nodes, connections, business: context.user.business, createdBy: context.user._id }
            // if (!name || !nodes || !connections) throw new GraphQLError("Name, nodes, and connections are required", { extensions: { code: "BAD_USER_INPUT" } });
            // if (validateLoops(WorkflowTemplate)) throw new GraphQLError("Workflow contains a loop. Cycles are not allowed.", { extensions: { code: "BAD_USER_INPUT" } });
            const workflow = await Workflow.create({ business: context.user.business, createdBy: context.user._id, name, trigger, task });
            return workflow;
        },
        async updateWorkflow(_, { id, name, trigger, task, status }, context, info) {
            const workflow = await Workflow.findByIdAndUpdate(id, { $set: { ...(name && { name }), ...(trigger && { trigger }), ...(task && { task }), ...(status && { status }) } }, { new: true });
            return workflow;
        },
        async deleteWorkflow(_, { id }, context, info) {
            await Workflow.findByIdAndDelete(id);
            return true;
        },
        async testTask(_, { id, payload }, context, info) {
            const workflow = await Workflow.findById(id);
            if (!workflow) throw new GraphQLError("Workflow not found", { extensions: { code: "BAD_USER_INPUT" } });
            const result = await workflow.execute(payload, { eventId: `test-event-${Date.now()}` });
            return result;
        }

    }
};