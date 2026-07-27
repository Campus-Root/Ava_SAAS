
import { Lead, LeadTemplate } from "../../models/Leads.js";
import graphqlFields from "graphql-fields";
import { documentTypes, getSelectFields } from "../../utils/graphqlTools.js";
import { GraphQLError } from "graphql";
import {
  buildDuplicateQuery,
  mergeContactDetails,
  findMatchedHandles,
  extractHandles,
  indexLeadsByHandle,
  classifyBulkCreateRows,
} from "../../utils/leadDuplicateUtils.js";
import { Channel } from "../../models/Channels.js";
import { sendKafkaMessage } from "../../utils/kafka.js";
import { Message, MessageSession } from "../../models/Messages.js";
import { Providers } from "../../models/ExternalServiceProviders.js";
import { uploadFileToWhatsApp } from "../../utils/whatsapp-app-bootstrap.js";
import { Conversation } from "../../models/Conversations.js";
import { AgentModel } from "../../models/Agent.js";
import { fireAndForgetAxios } from "../../utils/fireAndForget.js";
import { normalizePhoneNumber } from "../../utils/setup.js";
import axios from "axios";

export const leadResolvers = {
  Query: {
    fetchleadsTemplates: async (
      _,
      { limit = 10, page = 1, id, isActive, templateId: ID },
      context,
      info
    ) => {
      const filter = { business: context.user.business };
      if (id !== undefined) filter._id = id;
      if (isActive !== undefined) filter.isActive = isActive;

      const requestedFields = graphqlFields(info, {}, { processArguments: false });
      const { rootFields } = getSelectFields(requestedFields.data);

      const [leadsTemplates, totalDocuments] = await Promise.all([
        LeadTemplate.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select(rootFields),
        LeadTemplate.countDocuments(filter),
      ]);

      return {
        data: leadsTemplates,
        metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments },
      };
    },

    fetchLeads: async (
      _,
      { limit = 10, page = 1, templateId, tag, name, id, status, origin },
      context,
      info
    ) => {
      const filter = { business: context.user.business };
      if (id !== undefined) filter._id = id;
      if (templateId !== undefined) filter.template = templateId;
      if (status !== undefined) filter.status = status;
      if (origin !== undefined) filter.source = origin;
      if (tag !== undefined) filter.tags = { $regex: tag, $options: 'i' };
      if (name !== undefined) filter.name = { $regex: name, $options: 'i' };

      const requestedFields = graphqlFields(info, {}, { processArguments: false });
      const { rootFields } = getSelectFields(requestedFields.data);

      const [leads, totalDocuments] = await Promise.all([
        Lead.find(filter)
          .sort({ updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select(rootFields),
        Lead.countDocuments(filter),
      ]);

      return {
        data: leads,
        metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments },
      };
    },
    
    validateBulkCreateLeads: async (_, { dataList }, context) => {
      const businessId = context.user.business;

      // One DB round-trip: fetch any leads that share a handle with this batch
      const orClauses = [];
      for (const input of dataList) {
        for (const { platform, handle } of extractHandles(input.contactDetails)) {
          orClauses.push({ [`contactDetails.${platform}`]: { $elemMatch: { handle } } });
        }
      }

      const existingLeads = orClauses.length
        ? await Lead.find({ business: businessId, $or: orClauses }).lean()
        : [];

      const { wouldCreate, conflicts } = classifyBulkCreateRows(
        dataList,
        indexLeadsByHandle(existingLeads)
      );

      return {
        wouldCreate,
        conflicts,
        summary: {
          total: dataList.length,
          wouldCreate: wouldCreate.length,
          existingDuplicates: conflicts.filter((c) => c.reason === 'EXISTING_LEAD').length,
          withinBatchDuplicates: conflicts.filter((c) => c.reason === 'WITHIN_BATCH').length,
        },
      };
    },
  },

  Mutation: {
    createLeadTemplate: async (_, { LeadTemplateInput }, context) => {
      const { name, description, fields, isActive } = LeadTemplateInput;
      if (!name)
        throw new GraphQLError("Name is required", { extensions: { code: "BAD_USER_INPUT" } });
      if (await LeadTemplate.findOne({ name, business: context.user.business }))
        throw new GraphQLError("Template name already exists", { extensions: { code: "BAD_USER_INPUT" } });

      return LeadTemplate.create({
        name, description, fields,
        isActive: isActive !== undefined ? isActive : true,
        business: context.user.business,
        createdBy: context.user._id,
      });
    },

    updateLeadTemplate: async (_, { id, LeadTemplateInput }, context) => {
      const { name, description, fields, isActive } = LeadTemplateInput;
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (fields !== undefined) updateData.fields = fields;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await LeadTemplate.findOneAndUpdate(
        { _id: id, business: context.user.business },
        updateData,
        { new: true, runValidators: true }
      );
      if (!updated)
        throw new GraphQLError("Template not found", { extensions: { code: "NOT_FOUND" } });
      return updated;
    },

    deleteLeadTemplate: async (_, { id }, context) => {
      const deleted = await LeadTemplate.findOneAndDelete({
        _id: id,
        business: context.user.business,
      });
      if (!deleted)
        throw new GraphQLError("Template not found", { extensions: { code: "NOT_FOUND" } });
      return true;
    },
    createLead: async (_, { LeadCreateInput }, context) => {
      const {
        templateId, name, contactDetails, lastInteractedAt, nextFollowUpAt,
        source, tags, leadScore, status, notes, data,
      } = LeadCreateInput;
      const businessId = context.user.business;
      const duplicateQuery = buildDuplicateQuery(contactDetails, businessId);
      const existingLead = duplicateQuery ? await Lead.findOne(duplicateQuery) : null;
      if (existingLead) throw new GraphQLError("Lead already exists", { extensions: { code: "DUPLICATE_LEAD", existingLeadId: existingLead._id.toString(), matchedOn: findMatchedHandles(contactDetails, existingLead) } });
      return Lead.create({
        template: templateId,
        contactDetails,
        lastInteractedAt,
        nextFollowUpAt,
        name, source, tags, leadScore,
        status: status || 'new',
        notes, data,
        business: businessId,
        createdBy: context.user._id,
      });
    },

    contactLead: async (_, { id, action = "sendMessage", channelId, message, file, caption, conversationId }, context) => {
      const lead = await Lead.findById(id);
      const channel = await Channel.findOne({ _id: channelId, business: context.user.business });
      if (!channel) throw new GraphQLError("Channel not found", { extensions: { code: "NOT_FOUND" } });
      await channel.populate('apiAuthenticator');
      await Providers.populate(channel, { path: 'apiAuthenticator.provider', select: 'name' });
      if (!lead) throw new GraphQLError("Lead not found", { extensions: { code: "NOT_FOUND" } });
      let result
      switch (channel.apiAuthenticator.provider.name) {
        case "Whatsapp": {
          let toId = null, topic = null, platformMeta = null;
          let type, data, content;
          topic = 'sending-whatsapp-message'
          const { whatsapp } = lead.contactDetails;
          toId = whatsapp?.find(entry => entry.isPrimary)?.handle ?? whatsapp?.[0]?.handle;
          if (!toId) {
            const { phone } = lead.contactDetails;
            const completePhoneNumber = phone?.find(entry => entry.isPrimary) ?? phone?.[0];
            const normalizedPhoneNumber = normalizePhoneNumber(completePhoneNumber?.handle, completePhoneNumber?.metadata?.country ?? 'IN');
            if (normalizedPhoneNumber) toId = normalizedPhoneNumber.countryCallingCode + normalizedPhoneNumber.nationalNumber;
            else throw new GraphQLError("Invalid phone number", { extensions: { code: "BAD_REQUEST" } })
          }
          platformMeta = {
            accessToken: channel.apiAuthenticator.credentials.accessToken,
            phone_number_id: channel.config.phone_number_id,
          };
          switch (action) {
            case "sendMessage":
              ({ type, data } = message) ?? {};
              content = data;
              break;
            case "sendMedia":
              if (!file) throw new GraphQLError("No file provided", { extensions: { code: "BAD_REQUEST" } });
              // ✅ Await the file promise first
              const { createReadStream, filename, mimetype } = await file.promise;
              console.log('File data:', { filename, mimetype });
              if (!createReadStream || typeof createReadStream !== 'function') throw new GraphQLError(`createReadStream is not a function. Received: ${JSON.stringify(Object.keys(fileData))}`, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
              // Create the upload stream
              const fileStream = createReadStream();
              const { id: mediaId } = await uploadFileToWhatsApp(fileStream, mimetype, filename, platformMeta);
              type = documentTypes.has(mimetype) ? "document" : mimetype.split("/")[0];
              content = [{
                id: mediaId,
                mimeType: mimetype,
                caption: caption,
                filename: filename, // documents only
                ref: { strategy: "whatsapp_media_id", value: mediaId, needsAuth: true, url: `https://graph.facebook.com/v23.0/${mediaId}` },
              }]
              data = { id: mediaId, caption: type === 'document' ? caption : null };
              break;
            default:
              break;
          }
          // create a message and conenct it to a conversation
          let conversation = null;
          // let CreateMessageSession = false;
          if (conversationId) {
            conversation = await Conversation.findById(conversationId);
            if (!conversation) throw new GraphQLError("Conversation not found", { extensions: { code: "NOT_FOUND" } });
            if (conversation.status !== 'open') {
              // CreateMessageSession = true;
              await conversation.updateStatus('open');
            }
          }
          else {
            const agent = await AgentModel.findOne({ business: context.user.business, channels: { $in: [channelId] } });
            conversation = await Conversation.create({
              agent: agent?._id,
              business: context.user.business,
              channel: channelId,
              lead: id,
              externalConversationId: toId?.toString() ?? 'unknown',
            });
            // CreateMessageSession = true;
          }
          result = await Message.create({
            conversation: conversation._id,
            business: context.user.business,
            externalMessageId: toId?.toString() ?? 'unknown',
            direction: 'outbound',
            sender: {
              type: 'user',
              id: context.user._id,
              name: context.user.name,
              ref: context.user._id,
              refModel: 'Users',
            },
            type: type,
            kind: 'message',
            content,
            statusTimeline: {
              initiated: new Date(),
            }
          });
          // if (CreateMessageSession) {
          //   await MessageSession.create({
          //     conversation: conversation._id,
          //     business: context.user.business,
          //     firstMessage: result._id
          //   });
          // }
          await sendKafkaMessage({ topic, messages: [{ key: toId?.toString() ?? 'unknown', value: JSON.stringify({ operation: 'sendMessage', toId, platformMeta, type, data, messageId: result._id.toString() }), }] });
          await sendKafkaMessage({ topic: 'socket-event', messages: [{ key: conversation._id.toString(), value: JSON.stringify({ nameSpace: "CONVERSATION", roomId: conversation._id, event: "message.send", payload: result }) }] });
          break;
        }
        case "Exotel": {
          // contact lead 
          let leadPhoneNumber = null;
          const { phone } = lead.contactDetails;
          const completePhoneNumber = phone?.find(entry => entry.isPrimary) ?? phone?.[0];
          const normalizedPhoneNumber = normalizePhoneNumber(completePhoneNumber?.handle, completePhoneNumber?.metadata?.country ?? 'IN');
          if (normalizedPhoneNumber) leadPhoneNumber = normalizedPhoneNumber.nationalNumber;
          else throw new GraphQLError("Invalid phone number", { extensions: { code: "BAD_REQUEST" } })
          const { accountSid } = channel.apiAuthenticator.credentials;
          const { exophone, appId } = channel.config;
          let lastConversation = await Conversation.findOne({ lead: id, channel: channelId, business: context.user.business });
          const agentDetails = await AgentModel.findOne({ channels: channelId })
          if (!lastConversation) lastConversation = await Conversation.create({ lead: id, channel: channelId, agent: agentDetails?._id, business: context.user.business, externalConversationId: leadPhoneNumber });
          result = await CallSession.create({
            lead: id,
            agent: agentDetails?._id,
            conversation: lastConversation?._id,
            business: context.user.business,
            channel: channel._id,
            direction: "outbound-dial",
            statusTimeline: { initiatedAt: new Date() },
            callDetails: {
              session: {
                model: agentDetails?.personalInfo?.VoiceAgentSessionConfig?.model,
                samplingRate: 8000,
                voice: agentDetails?.personalInfo?.VoiceAgentSessionConfig?.voice,
              }
            }
          });
          let body = {
            "input": {
              "From": leadPhoneNumber,
              "CallerId": exophone,
              "Url": `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`,
              "StatusCallback": `https://chat.avakado.ai/webhook/${channel.apiAuthenticator.provider.name}`,
              "Record": true,
              "CustomField": {
                callSession: result._id,
                business: context.user.business
              }
            },
            "apiId": "6a50b6bf445a2fbf099b4a29",
            "authId": channel.apiAuthenticator._id
          }
          try {
            const { data } = await axios.post(`https://chat.avakado.ai/aux/external-api-call`, body, { headers: { 'Content-Type': 'application/json' } });
            console.log('data:', JSON.stringify(data, null, 2));
          } catch (error) {
            const message = error?.response?.data?.message || error?.response?.data || error.message || "Unknown error";
            throw new GraphQLError(`Error contacting lead: ${JSON.stringify(message)}`, { extensions: { code: "INTERNAL_SERVER_ERROR" } });
          }
          break;
        }
        default:
          throw new GraphQLError("Invalid channel provider", { extensions: { code: "NOT_FOUND" } });
      }

      return result;
    },
    // ─── bulkCreateLeads ───────────────────────────────────────────────────────────

    bulkCreateLeads: async (_, { dataList }, context) => {
      const businessId = context.user.business;
      const created = [];
      const merged = [];
      const duplicatesRequiringMode = [];

      for (const input of dataList) {
        const {
          templateId, name, contactDetails, lastInteractedAt, nextFollowUpAt,
          source, tags, leadScore, status, notes, data, mode
        } = input;

        const duplicateQuery = buildDuplicateQuery(contactDetails, businessId);
        const existingLead = duplicateQuery ? await Lead.findOne(duplicateQuery) : null;

        if (existingLead) {
          if (!mode || !['merge', 'new'].includes(mode)) {
            // Don't throw — collect all conflicts and report at the end
            const matched = findMatchedHandles(contactDetails, existingLead);
            duplicatesRequiringMode.push({
              input,
              existingLeadId: existingLead._id,
              matchedOn: matched,
            });
            continue;
          }
          if (mode === 'merge') {
            const mergedContactDetails = mergeContactDetails(
              existingLead.contactDetails?.toObject?.() || existingLead.contactDetails,
              contactDetails
            );

            const updated = await Lead.findByIdAndUpdate(
              existingLead._id,
              {
                $set: {
                  contactDetails: mergedContactDetails,
                  ...(name && { name }),
                  ...(source && { source }),
                  ...(notes && { notes }),
                  ...(leadScore != null && { leadScore }),
                  ...(status && { status }),
                  ...(lastInteractedAt && { lastInteractedAt }),
                  ...(nextFollowUpAt && { nextFollowUpAt }),
                  ...(data && { data: { ...existingLead.data, ...data } }),
                },
                $addToSet: { tags: { $each: tags || [] } },
              },
              { new: true }
            );
            merged.push(updated);
            continue;
          }
        }
        const newLead = await Lead.create({
          template: templateId,
          contactDetails,
          lastInteractedAt,
          nextFollowUpAt,
          name, source, tags, leadScore,
          status: status || 'new',
          notes, data,
          business: businessId,
          createdBy: context.user._id,
        });
        created.push(newLead);
      }

      return { created, merged, duplicatesRequiringMode };
    },
    // bulkUpdateLeads: async (_, { dataList }, context) => {
    //   const updated = [];
    //   for (const input of dataList) {
    //     const { id, LeadCreateInput } = input;
    //     const updated = await Lead.findByIdAndUpdate(id, LeadCreateInput, { new: true, runValidators: true });
    //     updated.push(updated);
    //   }
    //   return updated;
    // },

    updateLead: async (_, { id, LeadCreateInput }, context) => {
      const { name, contactDetails, createdBy, lastInteractedAt, nextFollowUpAt, source, tags, leadScore, status, notes, data } = LeadCreateInput;
      const updateData = {};
      // Only set fields that were explicitly provided — never default status to "new" on update
      if (name !== undefined) updateData.name = name;
      if (source !== undefined) updateData.source = source;
      if (contactDetails !== undefined) updateData.contactDetails = contactDetails;
      if (createdBy !== undefined) updateData.createdBy = createdBy;
      if (lastInteractedAt !== undefined) updateData.lastInteractedAt = lastInteractedAt;
      if (nextFollowUpAt !== undefined) updateData.nextFollowUpAt = nextFollowUpAt;
      if (tags !== undefined) updateData.tags = tags;
      if (leadScore !== undefined) updateData.leadScore = leadScore;
      if (status !== undefined) updateData.status = status;
      if (notes !== undefined) updateData.notes = notes;
      if (data !== undefined) updateData.data = data;

      const updated = await Lead.findOneAndUpdate(
        { _id: id, business: context.user.business },
        updateData,
        { new: true, runValidators: true }
      );
      if (!updated)
        throw new GraphQLError("Lead not found", { extensions: { code: "NOT_FOUND" } });
      return updated;
    },

    deleteLead: async (_, { id }, context) => {
      const deleted = await Lead.findOneAndDelete({
        _id: id,
        business: context.user.business,
      });
      if (!deleted)
        throw new GraphQLError("Lead not found", { extensions: { code: "NOT_FOUND" } });
      return true;
    },
  },
};
