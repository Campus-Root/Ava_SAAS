import { Message } from "../../models/Messages.js";
import { CallSession } from "../../models/CallSessions.js";
import { Conversation } from "../../models/Conversations.js";
import { Business } from "../../models/Business.js";
import { Channel } from "../../models/Channels.js";
import graphqlFields from "graphql-fields";
import { getSelectFields } from "../../utils/graphqlTools.js";

// ─── Resolvers ────────────────────────────────────────────────────────────────

export const messageResolvers = {
  Query: {
    fetchMessages: async (
      _,
      { conversationId, limit = 20, page = 1 },
      context,
      info
    ) => {
      const skip = (page - 1) * limit;
      const filter = { business: context.user.business };
      if (conversationId) filter.conversation = conversationId; // field is "conversation", not "conversationId"

      const requestedFields = graphqlFields(info, {}, { processArguments: false });
      const { rootFields, populateFields } = getSelectFields(requestedFields.data);

      const [messages, totalDocuments] = await Promise.all([
        Message.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select(rootFields),
        Message.countDocuments(filter),
      ]);

      if (populateFields?.conversation)
        await Conversation.populate(messages, {
          path: "conversation",
          select: populateFields.conversation,
        });
      if (populateFields?.business)
        await Business.populate(messages, {
          path: "business",
          select: populateFields.business,
        });
      if (populateFields?.sender) {
        await Message.populate(messages, {
          path: "sender.ref",
          select: { _id: 1, name: 1, "personalInfo.name": 1 },
        });
      }
      if (populateFields?.repliedTo) {
        await Message.populate(messages, {
          path: "repliedTo",
          select: populateFields.repliedTo,
        });
      }
      return {
        data: messages,
        metaData: {
          page,
          limit,
          totalPages: Math.ceil(totalDocuments / limit),
          totalDocuments,
        },
      };
    },

    fetchCallSessions: async (
      _,
      { conversationId, ids = [], direction = [], externalCallSessionId = null, limit = 20, page = 1 },
      context,
      info
    ) => {
      const skip = (page - 1) * limit;
      const filter = { business: context.user.business };
      if (conversationId) filter.conversation = conversationId;
      if (direction.length > 0) filter.direction = { $in: direction };
      if (ids.length > 0) filter._id = { $in: ids };
      if (externalCallSessionId) filter.externalCallSessionId = externalCallSessionId;
      const requestedFields = graphqlFields(info, {}, { processArguments: false });
      const { rootFields, populateFields } = getSelectFields(requestedFields.data);

      const [callSessions, totalDocuments] = await Promise.all([
        CallSession.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select(rootFields),
        CallSession.countDocuments(filter),
      ]);

      if (populateFields?.conversation)
        await Conversation.populate(callSessions, {
          path: "conversation",
          select: populateFields.conversation,
        });
      if (populateFields?.business)
        await Business.populate(callSessions, {
          path: "business",
          select: populateFields.business,
        });
      if (populateFields?.channel)
        await Channel.populate(callSessions, {
          path: "channel",
          select: populateFields.channel,
        });

      return {
        data: callSessions,
        metaData: {
          page,
          limit,
          totalPages: Math.ceil(totalDocuments / limit),
          totalDocuments,
        },
      };
    },
  },
};
