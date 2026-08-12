import graphqlFields from 'graphql-fields';
import { flattenFields, getSelectFields } from '../../utils/graphqlTools.js';
import { Channel } from '../../models/Channels.js';
import { verifyTransporter } from '../../utils/sendEmail.js';
import { Telegraf } from 'telegraf';
import axios from 'axios';
import { GraphQLError } from 'graphql';
import { AgentModel } from '../../models/Agent.js';
import { Business } from '../../models/Business.js';
import { User } from '../../models/User.js';
import { ApiAuthenticators } from "../../models/apiAuthenticator.js";
import { Providers } from '../../models/ExternalServiceProviders.js';
import { PROVIDER_MAP } from '../../utils/setup.js';
export const channelResolvers = {
    Query: {
        async getChannels(_, { limit = 10, page = 1, id, provider, apiAuthenticator, status, type }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            const filter = { business: context.user.business };
            if (id) filter._id = id;
            if (status) filter.status = status;
            if (provider) filter.provider = provider;
            if (type) filter.type = type;
            if (apiAuthenticator) filter.apiAuthenticator = apiAuthenticator;
            const channels = await Channel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(rootFields);
            const totalDocuments = await Channel.countDocuments(filter);
            if (populateFields?.business) await Business.populate(channels, { path: 'business', select: populateFields.business });
            if (populateFields?.createdBy) await User.populate(channels, { path: 'createdBy', select: populateFields.createdBy });
            if (populateFields?.provider) await Providers.populate(channels, { path: 'provider', select: populateFields.provider });
            if (populateFields?.apiAuthenticator) await ApiAuthenticators.populate(channels, { path: 'apiAuthenticator', select: populateFields.apiAuthenticator });
            return { data: channels, metaData: { page, limit, totalPages: Math.ceil(totalDocuments / limit), totalDocuments } };
        },
        async channelSettingMethods(_, { id }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            let channel = await Channel.findById(id).populate("apiAuthenticator").populate("provider");
            if (!channel) throw new GraphQLError('Channel not found', { extensions: { code: 'INVALID_INPUT' } });
            const serviceProvider = PROVIDER_MAP[channel.provider.name];
            if (!serviceProvider) throw new GraphQLError('ServiceProvider not found', { extensions: { code: 'INVALID_INPUT' } });
            return serviceProvider.listChannelSettingMethods();

        },
    },
    Mutation: {
        async createChannel(_, { input }, context, info) {
            const { name, runtime = 'TURN_BASED', apiAuthenticator, systemPrompt, isPublic, UIElements, type, config = {} } = input;
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            if (type == 'website') {
                const channel = await Channel.create({ name, business: context.user.business, runtime: 'TURN_BASED', status: "enabled", systemPrompt, isPublic, UIElements, type, config })
                await Business.populate(channel, { path: 'business', select: populateFields.business });
                return channel;
            }
            const apiAuthenticatorDoc = await ApiAuthenticators.findById(apiAuthenticator);
            if (!apiAuthenticatorDoc) throw new GraphQLError('ApiAuthenticator not found', { extensions: { code: 'INVALID_INPUT' } });
            const provider = await Providers.findById(apiAuthenticatorDoc.provider);
            if (!provider) throw new GraphQLError('Provider not found', { extensions: { code: 'INVALID_INPUT' } });
            const serviceProvider = PROVIDER_MAP[provider.name];
            if (!serviceProvider) throw new GraphQLError('ServiceProvider not found', { extensions: { code: 'INVALID_INPUT' } });
            const channel = await Channel.create({ name, business: context.user.business, apiAuthenticator: apiAuthenticatorDoc._id, provider: provider._id, status: "enabled", systemPrompt, isPublic, UIElements, type })
            const { success, config: restConfigurations, error, externalId = "" } = await serviceProvider.setupChannel({ apiAuthenticator: apiAuthenticatorDoc, providerName: provider.name, channelId: channel._id, config, runtime });
            if (!success) throw new GraphQLError('Failed to setup channel', { extensions: { code: 'INVALID_INPUT', error } });
            channel.config = { ...config, ...restConfigurations };
            channel.externalId = externalId;
            await channel.save();
            await Business.populate(channel, { path: 'business', select: populateFields.business });
            await ApiAuthenticators.populate(channel, { path: 'apiAuthenticator', select: populateFields.apiAuthenticator });
            await Providers.populate(channel, { path: 'provider', select: populateFields.provider });
            return channel;
        },
        async channelSetting(_, { id, method, parameters }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            let channel = await Channel.findById(id).populate("apiAuthenticator").populate("provider");
            if (!channel) throw new GraphQLError('Channel not found', { extensions: { code: 'INVALID_INPUT' } });
            const serviceProvider = PROVIDER_MAP[channel.provider.name];
            if (!serviceProvider) throw new GraphQLError('ServiceProvider not found', { extensions: { code: 'INVALID_INPUT' } });
            const response = await serviceProvider[method]({ secrets: { channelConfig: channel.config, authentcatorDoc: channel.apiAuthenticator }, parameters });
            return response;
        },
        async updateChannel(_, { id, input }, context, info) {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { rootFields, populateFields } = getSelectFields(requestedFields.data);
            let channel = await Channel.findById(id);
            if (!channel) throw new GraphQLError('Channel not found', { extensions: { code: 'INVALID_INPUT' } });
            const { name, systemPrompt, isPublic, UIElements } = input;
            if (name !== undefined) channel.name = name;
            if (systemPrompt !== undefined) channel.systemPrompt = systemPrompt;
            if (isPublic !== undefined) channel.isPublic = isPublic;
            if (UIElements !== undefined) channel.UIElements = UIElements;
            await channel.save();
            await Business.populate(channel, { path: 'business', select: populateFields.business });
            await ApiAuthenticators.populate(channel, { path: 'apiAuthenticator', select: populateFields.apiAuthenticator });
            await Providers.populate(channel, { path: 'provider', select: populateFields.provider });
            return channel;
        },
        async deleteChannel(_, { id }, context) {
            const channel = await Channel.findOne({ _id: id, business: context.user.business });
            if (!channel) throw new GraphQLError('Channel not found', { extensions: { code: 'INVALID_INPUT' } });

            // const { success, config: restConfigurations } = await serviceProvider.teardownChannel({
            //     apiAuthenticator: apiAuthenticatorDoc,
            //     config: channel.config,
            // });
            // // proceed with delete regardless; restConfigurations.teardown shows what Meta cleaned up
            // await channel.deleteOne();


            switch (channel.type) {
                case "telegram": {
                    const bot = new Telegraf(channel.secrets?.botToken);
                    try {
                        await bot.telegram.deleteWebhook();          // remove webhook
                    } catch (err) {
                        console.warn("Telegram webhook deletion failed; continuing.", err.message);
                    }
                    break;
                }
                case "whatsapp": {
                    const { waba_id, phone_number_id } = channel.config ?? {};
                    const API_VERSION = "v23.0";
                    const token = channel.secrets?.permanentAccessToken;
                    if (token && waba_id) {
                        try {
                            await axios.delete(
                                `https://graph.facebook.com/${API_VERSION}/${waba_id}/subscribed_apps`,
                                { headers: { Authorization: `Bearer ${token}` } }
                            );
                        } catch (err) {
                            console.warn("WA unsubscribe failed; continuing.", err.message);
                        }
                    }
                    if (token && phone_number_id) {
                        try {
                            await axios.post(
                                `https://graph.facebook.com/${API_VERSION}/${phone_number_id}/deregister`,
                                { messaging_product: "whatsapp" },
                                { headers: { Authorization: `Bearer ${token}` } }
                            );
                        } catch (err) {
                            console.warn("WA deregister failed; continuing.", err.message);
                        }
                    }
                    break;
                }
                /* Add teardown for other channel types as needed */
                default:
                    break;
            }
            const deletedChannel = await Channel.findOneAndDelete({ _id: id, business: context.user.business });
            if (deletedChannel) {
                console.log("Deleted channel id:", deletedChannel._id);
                await AgentModel.updateMany({ channels: deletedChannel._id }, { $pull: { channels: deletedChannel._id } });
            }
        },
    },
};



// switch (type) {
//     case "email":
//         const { host, port, secure, fromName, defaultRecipients: { }, authType, user, pass, service, clientId, clientSecret, refreshToken, accessToken, expires } = config;
//         let mailConfig
//         channel.config = { host, port, secure, service, fromName, defaultRecipients, verified: false, lastVerifiedAt: new Date() }
//         channel.secrets = { authType, user, pass, clientId, clientSecret, refreshToken, accessToken, expires }
//         if (authType === "login") mailConfig = { host, port, secure, auth: { user, pass } }
//         else if (authType === "oauth2") mailConfig = { service, auth: { type: "OAuth2", user, clientId, clientSecret, refreshToken } }
//         const { success } = await verifyTransporter(mailConfig)
//         if (!success) {
//             await channel.updateStatus("failed")
//             return new GraphQLError("transporter verification failed", { extensions: { code: 'INVALID_INPUT' } });
//         }
//         await channel.save()
//         await channel.updateStatus("success")
//         break;
//     case "phone":
//         const { integrationId, phoneNumber = "", PhoneNumberSid = "", inboundSetup = false } = config;
//         const integration = await Integration.findOne({ _id: integrationId, business: context.user.business },).select({ _id: 1, "metaData.type": 1, config: 1, secrets: 1 });
//         if (!integration) return new GraphQLError("Integration not found", { extensions: { code: 'INVALID_INPUT' } });
//         channel.config = { integration: integration._id, provider: integration.metaData.type, phoneNumber, PhoneNumberSid }
//         switch (integration.metaData.type) {
//             case "twilio":

//             case "tataTele":
//                 if (inboundSetup) {
//                     const tataTele = new TataTeleService(integration.secrets.apiKey, integration.secrets.apiToken)
//                     const inboundPhoneNumber = await tataTele.assignPhoneNumberToFlow(PhoneNumberSid)
//                     console.log("updated inbound phone number", inboundPhoneNumber)
//                 }
//                 break;
//         }
//         await channel.save()
//         await channel.updateStatus("phone channel configured")
//         break;
//     case "instagram":
//         const { instagramCode } = config;
//         if (!instagramCode || instagramCode.trim === "") return new GraphQLError("instagramCode not found", { extensions: { code: 'INVALID_INPUT' } });
//         try {
//             const form = new FormData();
//             form.append('client_id', IG_ClIENT_ID);
//             form.append('client_secret', IG_CLIENT_Secret);
//             form.append('grant_type', 'authorization_code');
//             form.append('redirect_uri', 'https://www.avakado.ai/integrations/instagram');
//             form.append('code', instagramCode);
//             const { data } = await axios.post('https://api.instagram.com/oauth/access_token', form, {
//                 headers: form.getHeaders()
//             })
//             const { access_token, user_id, permissions } = data;
//             channel.secrets = { accessToken: access_token, permissions, expiresAt: new Date(Date.now() + 60 * 60 * 1000) }; // Set expiresAt to 1 hour from now
//             channel.config = { user_id_graphAPI: user_id };
//             await channel.save();
//             await channel.updateStatus("fetched short living access token");
//         } catch (error) {
//             if (error.response) console.error({ data: error.response.data, status: error.response.status, headers: error.response.headers });
//             else if (error.request) console.error("The request was made but no response was received", { request: error.request });
//             else console.error('Error', error.message);
//             console.error({ config: error.config });
//             return new GraphQLError("Error exchanging code for token", { extensions: { code: 'INVALID_INPUT' } });
//         }
//         try {
//             const url = 'https://graph.instagram.com/access_token';
//             const params = {
//                 grant_type: 'ig_exchange_token',
//                 client_secret: IG_CLIENT_Secret,
//                 access_token: channel.secrets.accessToken,
//             };
//             const { data } = await axios.get(url, { params });
//             const { access_token, token_type, expires_in } = data;
//             channel.secrets = { accessToken: access_token, permissions, expiresAt: expires_in * 1000 + Date.now() };
//             await channel.save();
//             await channel.updateStatus("fetched long living access token");
//         } catch (error) {
//             if (error.response) console.error({ data: error.response.data, status: error.response.status, headers: error.response.headers });
//             else if (error.request) console.error("The request was made but no response was received", { request: error.request });
//             else console.error('Error', error.message);
//             console.error({ config: error.config });
//             return new GraphQLError("Error exchanging code for token", { extensions: { code: 'INVALID_INPUT' } });
//         }
//         try {
//             const url = `https://graph.instagram.com/v23.0/${channel.config.user_id_graphAPI}`;
//             const params = {
//                 fields: 'user_id,username,name,account_type,profile_picture_url',
//                 access_token: channel.secrets.accessToken
//             };
//             const { data } = await axios.get(url, { params });
//             const { user_id, username, name, account_type, profile_picture_url } = data;
//             channel.config = { ...channel.config, igBusinessId: user_id, username, name, account_type, profile_picture_url };
//             await channel.save();
//             await channel.updateStatus("fetched user details");
//         } catch (error) {
//             if (error.response) console.error({ data: error.response.data, status: error.response.status, headers: error.response.headers });
//             else if (error.request) console.error("The request was made but no response was received", { request: error.request });
//             else console.error('Error', error.message);
//             console.error({ config: error.config });
//             return new GraphQLError("Error fetching user details", { extensions: { code: 'INVALID_INPUT' } });
//         }
//         break;
//     case "sms":
//         break;
//     default:
//         break;
// }




// const { name, systemPrompt, isPublic, UIElements, config, workflow } = input;
// if (name !== undefined) channel.name = name;
// if (systemPrompt !== undefined) channel.systemPrompt = systemPrompt;
// if (isPublic !== undefined) channel.isPublic = isPublic;
// if (UIElements !== undefined) channel.UIElements = UIElements;
// if (workflow !== undefined) channel.workflow = workflow;
// if (config) {
//     const newConfig = config;
//     switch (channel.type) {
//         case "email":
//             const { host, port, secure, fromName, defaultRecipients: { to: [], cc: [], bcc: [], }, authType, user, pass, service, clientId, clientSecret, refreshToken, accessToken, expires } = newConfig;
//             let mailConfig
//             channel.config = { host, port, secure, service, fromName, defaultRecipients, verified: false, lastVerifiedAt: new Date() }
//             channel.secrets = { authType, user, pass, clientId, clientSecret, refreshToken, accessToken, expires }
//             if (authType === "login") mailConfig = { host, port, secure, auth: { user, pass } }
//             else if (authType === "oauth2") mailConfig = { service, auth: { type: "OAuth2", user, clientId, clientSecret, refreshToken } }
//             const { success } = await verifyTransporter(mailConfig)
//             if (!success) {
//                 await channel.updateStatus("failed")
//                 return { statusCode: 400, message: "transporter verification failed", data: null }
//             }
//             await channel.save()
//             await channel.updateStatus("success")
//             break;
//         case "telegram":
//             const { telegramToken } = newConfig;
//             if (!telegramToken) break;            // nothing to change

//             // re-initialise bot with new token
//             const bot = new Telegraf(telegramToken);
//             try {
//                 const botInfo = await bot.telegram.getMe();
//                 const webhookUrl = `https://chat.avakado.ai/webhook/telegram/${botInfo.id}`;

//                 // Set webhook to new URL
//                 await bot.telegram.setWebhook(webhookUrl);
//                 channel.config = { ...botInfo, url: `https://t.me/${botInfo.username}` }
//                 channel.secrets = { botToken: telegramToken };
//                 channel.webhookUrl = webhookUrl;
//                 channel.status = "bot webhook updated";
//             } catch (err) {
//                 console.error(err);
//                 return { statusCode: 401, message: "Invalid/new Telegram token", data: err };
//             }
//             break;
//         case "whatsapp":
//             const { whatsappCode, phone_number_id, waba_id, business_id } = newConfig;
//             if (!whatsappCode) break;             // nothing to change

//             const API_VERSION = "v23.0";
//             try {
//                 const { data } = await axios.get(
//                     `https://graph.facebook.com/v21.0/oauth/access_token` +
//                     `?client_id=${process.env.WA_CLIENT_ID}` +
//                     `&client_secret=${process.env.WA_CLIENT_SECRET}` +
//                     `&code=${whatsappCode}`
//                 );

//                 channel.secrets = {
//                     permanentAccessToken: data.access_token,
//                     phoneNumberPin: Math.floor(Math.random() * 900000) + 100000,
//                     verificationToken: randomBytes(9).toString("hex")
//                 };

//                 const webhookUrl = `https://chat.avakado.ai/webhook/whatsapp/${phone_number_id}`;
//                 channel.webhookUrl = webhookUrl;
//                 channel.config = { phone_number_id, waba_id, business_id };
//                 channel.status = "fetched new access token";
//                 await channel.save();

//                 // Update webhook on WA side
//                 await axios.post(
//                     `https://graph.facebook.com/${API_VERSION}/${waba_id}/subscribed_apps`,
//                     {
//                         override_callback_uri: webhookUrl,
//                         verify_token: channel.secrets.verificationToken
//                     },
//                     { headers: { Authorization: `Bearer ${channel.secrets.permanentAccessToken}` } }
//                 );

//                 // Re-register phone number
//                 await axios.post(
//                     `https://graph.facebook.com/${API_VERSION}/${phone_number_id}/register`,
//                     { messaging_product: "whatsapp", pin: channel.secrets.phoneNumberPin },
//                     { headers: { Authorization: `Bearer ${channel.secrets.permanentAccessToken}` } }
//                 );

//                 channel.status = "whatsapp webhook & registration updated";
//             } catch (err) {
//                 console.error(err);
//                 return { statusCode: 401, message: "WhatsApp re-configuration failed", data: err };
//             }
//             break;
//         //     const { AccountSid, state, phoneNumber, TWILIO_AUTH_TOKEN } = newConfig
//         //     if (AccountSid) channel.config.AccountSid = AccountSid
//         //     if (state) channel.config.state = state
//         //     if (phoneNumber) channel.config.phoneNumber = phoneNumber
//         //     if (TWILIO_AUTH_TOKEN) channel.secrets.accessToken = TWILIO_AUTH_TOKEN
//         //     await channel.save()
//         //     await channel.updateStatus("twilio configured")
//         /* other providers (web / phone / sms / email / instagram) can go here */
//         default:
//             break;
//     }
// }
// return await channel.save();