import graphqlFields from "graphql-fields";
import { Ticket } from '@avakado.ai/schemas';
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { Business } from "@avakado.ai/schemas";
export const ticketResolvers = {
    Query: {
        async fetchTickets(_, { notifierEmail, channel, priority, status, id }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields);
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            if (notifierEmail) filter.notifierEmail = notifierEmail;
            if (status) filter.status = status;
            if (channel) filter.channel = id;
            if (priority) filter.priority = priority;
            const tickets = await Ticket.find(filter).sort({ createdAt: -1 }).select(rootFields);
            if (populateFields?.business) await Business.populate(tickets, { path: "business", select: populateFields.business });
            return tickets
        }
    },
    Mutation: {
        async updateTicket(_, { input, id }, context, info) { return {} },
        async deleteTicket(_, { id }, context, info) { return true }
    }
};