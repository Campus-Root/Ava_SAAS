import { GraphQLError } from "graphql";
import { ApiAuthenticators } from "../../models/apiAuthenticator.js";
import { Api, Providers } from "../../models/ExternalServiceProviders.js";
import { PROVIDER_MAP } from "../../utils/setup.js";
import graphqlFields from "graphql-fields";
import { getSelectFields } from "../../utils/graphqlTools.js";
import { evaluateData, serializeBody } from "./helpers.js";
import axios from "axios";
export const serviceProvidersResolvers = {
    Query: {
        fetchProviders: async (_, { name, description, _id, page = 1, limit = 10 }, context) => {
            const filter = {};
            if (name) filter.name = { $regex: name, $options: 'i' };
            if (description) filter.description = { $regex: description, $options: 'i' };
            if (_id) filter._id = _id;
            const providers = await Providers.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
            const totalDocuments = await Providers.countDocuments(filter);
            return { data: providers, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        fetchApis: async (_, { providers, providerName, title, description, version, _id, page = 1, limit = 10, category, feature }, context, info) => {
            const filter = {};
            // 🛡️ Safe checks
            if (providers?.length) filter.provider = { $in: providers };
            if (title) filter.title = title;
            if (description) filter.description = description;
            if (version) filter.version = version;
            if (_id) filter._id = _id;
            if (category) filter["metadata.category"] = category;
            if (feature) filter["metadata.feature"] = feature;
            const skip = (page - 1) * limit;
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            // 🔥 If providerName is present → use aggregation
            if (providerName) {
                const projectFields = {};
                if (rootFields) {
                    rootFields.trim().split(' ').forEach(field => {
                        projectFields[field] = 1;
                    });
                }
                const pipeline = [
                    { $match: filter },
                    {
                        $lookup: {
                            from: 'Providers',
                            localField: 'provider',
                            foreignField: '_id',
                            as: 'provider'
                        }
                    },
                    { $unwind: '$provider' },
                    { $match: { 'provider.name': providerName } },
                    {
                        $facet: {
                            data: [
                                { $skip: skip },
                                { $limit: limit },
                                { $project: projectFields }
                            ],
                            totalCount: [{ $count: 'count' }]
                        }
                    }
                ];
                const result = await Api.aggregate(pipeline);
                const data = result[0]?.data || [];
                const totalDocuments = result[0]?.totalCount[0]?.count || 0;
                return { data, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
            }
            // ✅ Normal query (no aggregation)
            const [apis, totalDocuments] = await Promise.all([Api.find(filter).skip(skip).limit(limit).select(rootFields), Api.countDocuments(filter)]);
            if (populateFields?.provider) await Providers.populate(apis, { path: 'provider', select: populateFields.provider });
            return { data: apis, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        fetchApiAuthenticators: async (_, { provider, providerName, _id, page = 1, limit = 10 }, context) => {
            const filter = { business: context.user.business };
            if (provider) filter.provider = provider;
            if (_id) filter._id = _id;
            const skip = (page - 1) * limit;
            if (providerName) {
                const pipeline = [{ $match: filter }, { $lookup: { from: 'Providers', localField: 'provider', foreignField: '_id', as: 'provider' } }, { $unwind: '$provider' }, { $match: { 'provider.name': { $regex: providerName, $options: 'i' } } }, { $facet: { data: [{ $skip: skip }, { $limit: limit }], totalCount: [{ $count: 'count' }] } }];
                const result = await ApiAuthenticators.aggregate(pipeline);
                const data = result[0]?.data || [];
                const totalDocuments = result[0]?.totalCount[0]?.count || 0;
                return { data, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
            }
            const apiAuthenticators = await ApiAuthenticators.find(filter).skip(skip).limit(limit).populate('provider');
            const totalDocuments = await ApiAuthenticators.countDocuments(filter);
            return { data: apiAuthenticators, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        }
    },
    Mutation: {
        createProvider: async (_, { name, description, icon, color, basicScopes }, context) => {
            return await Providers.create({ name, description, icon, color, basicScopes, apiFilters: {}, createdBy: context.user._id });
        },
        updateProvider: async (_, { id, name, description, icon, color }, context) => {
            const fieldsToUpdate = {};
            if (name) fieldsToUpdate.name = name;
            if (description) fieldsToUpdate.description = description;
            if (icon) fieldsToUpdate.icon = icon;
            if (color) fieldsToUpdate.color = color;
            if (apiFilters) fieldsToUpdate.apiFilters = apiFilters;
            return await Providers.findByIdAndUpdate(id, fieldsToUpdate, { new: true });
        },
        deleteProvider: async (_, { id }) => {
            return await Providers.findByIdAndDelete(id);
        },
        createAuthStrategy: async (_, { apiId, state = "" }, context) => {
            const api = await Api.findById(apiId).populate('provider');
            if (!api) throw new GraphQLError("Api not found", { extensions: { code: 'INVALID_INPUT' } });
            const providerService = PROVIDER_MAP[api.provider.name];
            if (!providerService) throw new GraphQLError("Provider not found", { extensions: { code: 'INVALID_INPUT' } });
            const scopes = [...new Set([...api.provider.basicScopes, ...api.requiredScopes])];
            if (!scopes?.length) throw new GraphQLError("Scopes not found", { extensions: { code: 'INVALID_INPUT' } });
            const { ExpectedKeysFromQuery = null, AuthUrl, error = null } = providerService.getAuthUrl({ state, scopes })
            if (error) throw new GraphQLError(error.message, { extensions: { code: error.code } });
            let authStrategy = { authType: api.schemas.auth, authUrl: AuthUrl, scopes: scopes, providerId: api.provider._id, misc: { requiredKeysFromQuery: ExpectedKeysFromQuery } }
            return authStrategy;
        },
        createApiAuthenticator: async (_, { providerId, authType, existingAuthenticatorId = null, keys = {} }, context) => {
            const provider = await Providers.findById(providerId);
            if (!provider) throw new GraphQLError("Provider not found", { extensions: { code: 'INVALID_INPUT' } });
            const oauthProvider = PROVIDER_MAP[provider.name];
            if (!oauthProvider) throw new GraphQLError("Provider not found", { extensions: { code: 'INVALID_INPUT' } });
            const result = await oauthProvider.getTokens(keys);
            if (!result.success) throw new GraphQLError(result.error.message, { extensions: { code: result.error.code } });
            const { credentials, scope, accountDetails, config } = result.data;
            if (existingAuthenticatorId) {
                const update = { $set: { credentials, config, accountDetails } };
                if (scope?.length > 0) update.$addToSet = { scope: { $each: scope } };
                const existingAuthenticator = await ApiAuthenticators.findByIdAndUpdate(existingAuthenticatorId, update, { new: true, runValidators: true });
                if (!existingAuthenticator) throw new GraphQLError("Authenticator not found", { extensions: { code: 'INVALID_INPUT' } });
                return existingAuthenticator;
            }
            return await ApiAuthenticators.create({ provider: providerId, authType, credentials, config, accountDetails, scope, createdBy: context.user._id, business: context.user.business });
        },
        createApi: async (_, { providerId, title, description, version, schemas, requestTemplate, requiredScopes, metadata }, context) => {
            const provider = await Providers.findById(providerId);
            if (!provider) throw new GraphQLError("Provider not found", { extensions: { code: 'INVALID_INPUT' } });
            const api = await Api.create({ provider: providerId, title: title, description: description, version: version, schemas: schemas, requestTemplate: requestTemplate, requiredScopes: requiredScopes, metadata: metadata });
            return api
        },
        testApi: async (_, { apiId, authId, input, config }, context) => {
            let [auth, api] = await Promise.all([ApiAuthenticators.findById(authId), Api.findById(apiId)]);
            let serializedBody = null, evaluatedRequestTemplate = null;
            if (!auth || !api) return res.status(404).json({ success: false, message: 'Authentication or API not found' });
            try {
                input = { ...config ?? {}, ...input ?? {} };
                evaluatedRequestTemplate = evaluateData(api.requestTemplate, { input, auth });
                serializedBody = serializeBody(evaluatedRequestTemplate.body, evaluatedRequestTemplate.headers['Content-Type']);
            } catch (error) {
                console.error("Error in testApi evaluateData", error);
                throw new GraphQLError(error.message, { extensions: { code: 'Call Evaluation Failed' } });
            }
            try {
                const { method, url: { base, path, params }, headers } = evaluatedRequestTemplate;
                const { data } = await axios({ method, url: base + path, params, headers, data: serializedBody })
                return { success: true, data };
            } catch (error) {
                console.error("Error in testApi axios", error);
                throw new GraphQLError(error.message, { extensions: { code: 'Call Evaluation Failed' } });
            }
        },
        updateApi: async (_, { id, title, description, version, schemas, requestTemplate, requiredScopes, metadata }, context) => {
            const api = await Api.findByIdAndUpdate(id, { title: title, description: description, version: version, schemas: schemas, requestTemplate: requestTemplate, requiredScopes: requiredScopes, metadata: metadata }, { new: true });
            return api
        },
        deleteApi: async (_, { id }) => {
            return await Api.findByIdAndDelete(id);
        }
    }
};