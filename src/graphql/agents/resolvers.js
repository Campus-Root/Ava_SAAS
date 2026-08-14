import graphqlFields from 'graphql-fields';
import { AgentModel } from '../../models/Agent.js';
import { Collection } from '../../models/Collection.js';
import { Action } from '../../models/Action.js';
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { openai } from '../../utils/openai.js';
import { Channel } from '../../models/Channels.js';
import { Business } from '../../models/Business.js';
import { User } from '../../models/User.js';
import axios from 'axios';
import { GoogleGenAI } from "@google/genai";
import { Workflow } from '../../models/Workflow.js';
import { DemonstrationModel } from '../../models/Demonstarations.js';
export const agentResolvers = {
    Query: {
        agents: async (_, { limit = 10, page = 1, isPublic, isFeatured, id }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const filter = {};
            filter.business = context.user.business;
            if (isPublic !== undefined) filter.isPublic = isPublic;
            if (isFeatured !== undefined) filter.isFeatured = isFeatured;
            if (id !== undefined) filter._id = id;
            const agents = await AgentModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(rootFields);
            const totalDocuments = await AgentModel.countDocuments(filter);
            if (populateFields?.workflow) await Workflow.populate(agents, { path: 'workflow', select: populateFields.workflow });
            if (populateFields?.business) await Business.populate(agents, { path: 'business', select: populateFields.business });
            if (populateFields?.createdBy) await User.populate(agents, { path: 'createdBy', select: populateFields.createdBy });
            if (populateFields?.channels) await Channel.populate(agents, { path: 'channels', select: populateFields.channels });
            if (populateFields?.collections) await Collection.populate(agents, { path: 'collections', select: populateFields.collections });
            if (populateFields?.actions) await Action.populate(agents, { path: 'actions', select: populateFields.actions });
            return { data: agents, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        ephemeralToken: async (_, { id, model, voice, provider }, context, info) => {
            try {
                let sessionConfig = {};
                if (model && voice && provider) sessionConfig = { model, voice, provider };
                else if (id) {
                    const filter = {
                        // business: context.user.business,
                        _id: id
                    };
                    const agentDetails = await AgentModel.findOne(filter).select({ personalInfo: 1 });
                    if (!agentDetails) throw new GraphQLError("Agent not found", { extensions: { code: "NOT_FOUND" } });
                    const dbModel = agentDetails.modelConfig.model;
                    const dbProvider = agentDetails.modelConfig.provider;
                    const dbVoice = agentDetails.responseConfig.audio.output.voice;
                    sessionConfig = { model: dbModel, provider: dbProvider, voice: dbVoice };
                } else {
                    throw new GraphQLError("Either (model, voice, provider) or id must be provided.", { extensions: { code: "BAD_REQUEST" } });
                }
                switch (sessionConfig.provider) {
                    case "openai":
                        {
                            const { data } = await axios.post(
                                "https://api.openai.com/v1/realtime/client_secrets",
                                {
                                    session: {
                                        type: "realtime", model: sessionConfig.model, audio: {
                                            input: {
                                                noise_reduction: { type: "near_field" },
                                            },
                                            output: { voice: sessionConfig.voice }
                                        },
                                    },
                                },
                                {
                                    headers: {
                                        Authorization: `Bearer ${process.env.OPEN_API_KEY}`,
                                        "Content-Type": "application/json",
                                    }
                                },
                            );
                            return data
                        }
                    case "gemini":
                        {
                            const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                            const token = await client.authTokens.create({
                                config: {
                                    uses: 1,
                                    expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                                    liveConnectConstraints: {
                                        model: sessionConfig.model,
                                        config: {
                                            audioConfig: {
                                                voiceConfig: {
                                                    voice: sessionConfig.voice
                                                }
                                            },
                                            responseModalities: ['AUDIO']
                                        }
                                    },
                                    httpOptions: {
                                        apiVersion: 'v1alpha'
                                    }
                                }
                            });
                            return token
                        }
                    default:
                        throw new GraphQLError("Invalid provider", { extensions: { code: "INVALID_PROVIDER" } });
                }


            } catch (error) {
                console.error("Session Creation Error:", error.message);
                throw new GraphQLError(error.message || "Failed to create session", { extensions: { code: "SESSION_CREATION_FAILED" } });
            }
        },

    },
    Mutation: {
        createAgent: async (_, { agent }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            let { personalInfo, runtime, modelConfig, responseConfig, actions = [], channels = [], collections = [], workflow, isPublic, isFeatured, analysisMetrics } = agent;
            const [foundChannels, foundCollections, foundActions, foundWorkflow] = await Promise.all([
                Promise.all(channels.map(id => Channel.findOne({ _id: id, business: context.user.business }, "_id"))),
                Promise.all(collections.map(id => Collection.findOne({ _id: id, business: context.user.business }, "_id"))),
                Promise.all(actions.map(id => Action.findOne({ _id: id, business: context.user.business }, "_id"))),
                workflow ? Workflow.findOne({ _id: workflow, business: context.user.business }, "_id") : null,
            ]);
            if (workflow && !foundWorkflow) throw new GraphQLError("Workflow not found", { extensions: { code: "WORKFLOW_NOT_FOUND" } });
            if (foundChannels.length !== channels.length) throw new GraphQLError("Channel not found", { extensions: { code: "CHANNEL_NOT_FOUND" } });
            if (foundCollections.length !== collections.length) throw new GraphQLError("Collection not found", { extensions: { code: "COLLECTION_NOT_FOUND" } });
            if (foundActions.length !== actions.length) throw new GraphQLError("Action not found", { extensions: { code: "ACTION_NOT_FOUND" } });
            const newAgent = await AgentModel.create({ personalInfo, runtime, modelConfig, responseConfig, channels, actions, collections, workflow, business: context.user.business, createdBy: context.user._id, isPublic, isFeatured, analysisMetrics })
            await Business.populate(newAgent, { path: 'business', select: nested.business });
            await Workflow.populate(newAgent, { path: 'workflow', select: nested.workflow });
            await User.populate(newAgent, { path: 'createdBy', select: nested.createdBy });
            await Channel.populate(newAgent, { path: 'channels', select: nested.channels });
            await Collection.populate(newAgent, { path: 'collections', select: nested.collections });
            await Action.populate(newAgent, { path: 'actions', select: nested.actions });
            return newAgent;
        },
        updateAgent: async (_, { id, agent }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            let { actions = [], channels = [], collections = [], workflow } = agent;
            const [foundChannels, foundCollections, foundActions, foundWorkflow] = await Promise.all([
                Promise.all(channels.map(id => Channel.findOne({ _id: id, business: context.user.business }, "_id"))),
                Promise.all(collections.map(id => Collection.findOne({ _id: id, business: context.user.business }, "_id"))),
                Promise.all(actions.map(id => Action.findOne({ _id: id, business: context.user.business }, "_id"))),
                workflow ? Workflow.findOne({ _id: workflow, business: context.user.business }, "_id") : null,
            ]);
            if (workflow && !foundWorkflow) throw new GraphQLError("Workflow not found", { extensions: { code: "WORKFLOW_NOT_FOUND" } });
            if (foundChannels.length !== channels.length) throw new GraphQLError("Channel not found", { extensions: { code: "CHANNEL_NOT_FOUND" } });
            if (foundCollections.length !== collections.length) throw new GraphQLError("Collection not found", { extensions: { code: "COLLECTION_NOT_FOUND" } });
            if (foundActions.length !== actions.length) throw new GraphQLError("Action not found", { extensions: { code: "ACTION_NOT_FOUND" } });
            console.log("agent", JSON.stringify(agent, null, 2));
            const updatedAgent = await AgentModel.findByIdAndUpdate(id, { ...agent, updatedAt: new Date() }, { new: true });
            console.log("updatedAgent", JSON.stringify(updatedAgent, null, 2));
            await Business.populate(updatedAgent, { path: 'business', select: nested.business });
            await Workflow.populate(updatedAgent, { path: 'workflow', select: nested.workflow });
            await User.populate(updatedAgent, { path: 'createdBy', select: nested.createdBy });
            await Channel.populate(updatedAgent, { path: 'channels', select: nested.channels });
            await Collection.populate(updatedAgent, { path: 'collections', select: nested.collections });
            await Action.populate(updatedAgent, { path: 'actions', select: nested.actions });
            return updatedAgent;
        },
        deleteAgent: async (_, { id }, context) => {
            const result = await AgentModel.findByIdAndDelete(id);
            return !!result;
        },
        generatePrompt: async (_, { prompt }, context) => {
            const systemInstruction = `You are an expert prompt engineer. Your job is to take a rough or draft input describing an AI assistant and generate a polished, detailed, and optimized system prompt. The final output should clearly define the assistant's name, role, goals, tone, limitations, language, audience, response style, and fallback behavior in a structured and professional format.`;
            const aiResponse = await openai.chat.completions.create({
                model: "gpt-4.1-mini-2025-04-14",
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: JSON.stringify(prompt) }
                ],
                // max_tokens: 500,
            });
            // note usage
            console.log("prompt gen response", JSON.stringify(aiResponse, null, 2));
            return aiResponse.choices[0].message.content.trim();
        },
        startDemo: async (_, { input }, context) => {
            let { leadName, leadEmail, leadPhone, leadDepartment, leadSource, organizationId, organizationName, organizationIndustry, kind } = input;
            const newDemo = await DemonstrationModel.create({ lead: { name: leadName, email: leadEmail, phone: leadPhone, department: leadDepartment, source: leadSource }, organization: { id: organizationId, name: organizationName, industry: organizationIndustry }, kind })
            return newDemo;
        },
        endDemo: async (_, { _id, transcripts, miscellaneous }, context) => {
            const updatedDemo = await DemonstrationModel.findByIdAndUpdate(_id, { demoEndedAt: new Date(), transcripts, miscellaneous }, { new: true });
            return updatedDemo;
        }
    }
}; 