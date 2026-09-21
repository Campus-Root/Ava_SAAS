import graphqlFields from "graphql-fields";
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { Notification } from '@avakado.ai/schemas';
export const notificationResolvers = {
    Query: {
        async fetchNotifications(_, __, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields);
            return await Notification.find({ business: context.user.business }).select(rootFields).sort({ createdAt: -1 });
        },
    },
    Mutation: {
        async updateNotifications(_, { id, status }, context, info) {
            return await Notification.findByIdAndUpdate(id, { status }, { new: true });
        },
        async deleteNotifications(_, { id }, context, info) {
            await Notification.findByIdAndDelete(id);
            return true;
        }
    }
};