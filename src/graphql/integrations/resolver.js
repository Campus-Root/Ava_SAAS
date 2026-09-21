import { GraphQLError } from "graphql";
import { Integration } from '@avakado.ai/schemas';
import { ZohoCRMIntegration } from "../../utils/Zoho.js";
import graphqlFields from "graphql-fields";
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { TwilioService } from "../../utils/twilio.js";
import { Business } from "@avakado.ai/schemas";
import { User } from '@avakado.ai/schemas';
import { Channel } from '@avakado.ai/schemas';
import { AgentModel } from '@avakado.ai/schemas';
import { ExotelService } from "../../utils/exotel.js";
const { TWILIO_AUTH_TOKEN } = process.env;
export const IntegrationResolvers = {
    Query: {
        fetchIntegration: async (_, { id, limit = 5, page = 1 }, context, info) => {
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const integration = await Integration.find(filter).skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 }).select(rootFields); 
            const totalDocuments = await Integration.countDocuments(filter);
            if (populateFields?.business) await Business.populate(integration, { path: 'business', select: populateFields.business });
            if (populateFields?.createdBy) await User.populate(integration, { path: 'createdBy', select: populateFields.createdBy });
            return {data: integration, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments }};
        }
    },
    Mutation: {
        createIntegration: async (_, { type, name, purpose, config }, context, info) => {  // code, domain, AccountSid, state,
            let integration, accountDetails
            switch (type) {
                case "zoho": {
                    const { code, domain } = config;
                    const zohoCRM = new ZohoCRMIntegration();
                    const { success, data } = await zohoCRM.getTokens(code, domain);
                    if (!success) return new GraphQLError('invalid code or domin', { extensions: { code: 'INVALID_INPUT' } });
                    integration = await Integration.create({
                        business: context.user.business,
                        metaData: {
                            name: name || 'Zoho CRM',
                            description: 'Zoho CRM',
                            icon: 'https://www.zoho.com/favicon.ico',
                            color: '#000000',
                            purpose: 'crm',
                            type
                        },
                        secrets: {
                            tokenType: data.token_type,
                            accessToken: data.access_token,
                            refreshToken: data.refresh_token,
                        },
                        config: {
                            apiDomainUrl: data.api_domain,
                            domain: domain,
                            scope: data.scope,
                            expiresAt: new Date(Date.now() + (data.expires_in * 1000))
                        },
                        isActive: true,
                        createdBy: context.user._id
                    });
                    break;
                }
                case "twilio": {
                    const { AccountSid, state } = config;
                    if (!AccountSid) return new GraphQLError('AccountSid is required for Twilio integration', { extensions: { code: 'INVALID_INPUT' } });
                    const service = new TwilioService(AccountSid, TWILIO_AUTH_TOKEN);
                    accountDetails = JSON.parse(JSON.stringify(await service.getAccountDetails()));
                    integration = await Integration.create({
                        business: context.user.business,
                        metaData: {
                            name: name || 'Twilio',
                            description: 'Twilio SMS and Voice',
                            icon: 'https://www.svgrepo.com/show/354472/twilio-icon.svg',
                            color: '#000000',
                            purpose: purpose || 'voice and sms',
                            type
                        },
                        config: {
                            AccountSid: AccountSid,
                            state: state,
                        },
                        secrets: {
                            tokenType: "Bearer",
                            accessToken: TWILIO_AUTH_TOKEN,
                        },
                        accountDetails,
                        isActive: true,
                        createdBy: context.user._id
                    })
                    break;
                }
                case "exotel": {
                    const { apiKey, apiToken, AccountSid, subdomain, region = "Singapore" } = config
                    const exotel = new ExotelService(apiKey, apiToken, AccountSid, subdomain, region)
                    let accountDetails = await exotel.getAccountDetails()
                    integration = await Integration.create({
                        business: context.user.business,
                        metaData: {
                            name: name || 'exotel',
                            description: 'Exotel SMS and Voice',
                            icon: 'https://images.saasworthy.com/exotel_4675_logo_1586751614_tppiq.jpg',
                            color: '#000000',
                            purpose: purpose || 'voice and sms',
                            type
                        },
                        config: { AccountSid, domain: subdomain, region },
                        secrets: { tokenType: "Basic", accessToken: accountDetails.AuthToken, apiKey: apiKey, apiToken: apiToken },
                        accountDetails,
                        isActive: true,
                        createdBy: context.user._id
                    })
                    break;
                }
                case "tataTele": {
                    const { apiKey, apiToken } = config
                    integration = await Integration.create({
                        business: context.user.business,
                        metaData: {
                            name: name || 'tataTele',
                            description: 'Tata Tele SMS and Voice',
                            icon: 'https://upload.wikimedia.org/wikipedia/commons/f/fc/Tata_Teleservices_new_logo.png',
                            color: '#000000',
                            purpose: purpose || 'voice and sms',
                            type
                        },
                        secrets: { apiKey: apiKey, apiToken: apiToken },
                        isActive: true,
                        createdBy: context.user._id
                    })
                    break;
                }
                case "whatsapp": {
                    break;
                }
                default:
                    break;
            }
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            await Business.populate(integration, { path: 'business', select: nested.business });
            await User.populate(integration, { path: 'createdBy', select: nested.createdBy });
            return integration;
        },
        deAuthorizeIntegration: async (_, { integrationId }, context, info) => {
            const integration = await Integration.findOne({ _id: integrationId, business: context.user.business });
            if (!integration) return new GraphQLError('Integration not found', { extensions: { code: 'NOT_FOUND' } });
            switch (integration.metaData.type) {
                case "twilio":
                    break;
                default:
                    break;
            }
            const channelsToDelete = await Channel.find(
                { "config.integration": integrationId, business: context.user.business },
                { _id: 1 } // only fetch _id
            );
            console.log({ "channelsToDelete": channelsToDelete })
            if (channelsToDelete.length > 0) {
                const channelIds = channelsToDelete.map(c => c._id);

                // Step 2: Delete them
                await Channel.deleteMany({ _id: { $in: channelIds } });

                // Step 3: Pull them from all Agent documents
                await AgentModel.updateMany(
                    { channels: { $in: channelIds } },
                    { $pull: { channels: { $in: channelIds } } }
                );
                console.log("Deleted channel ids:", channelIds);
            }
            await Integration.findByIdAndDelete(integrationId);
            return true;
        }
    }
}