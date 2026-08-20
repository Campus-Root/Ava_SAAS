import axios from "axios";
import BaseOAuthProvider from "./base.js";
const { wa_client_id, wa_client_secret, wa_redirect_uri } = process.env;

const API_VERSION = "v23.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
/**
 * FIXED: WhatsApp OAuth Provider
 * 
 * Fixes applied:
 * ✓ Extends BaseOAuthProvider
 * ✓ Changed tokenError → error in getTokens
 * ✓ refreshToken() uses accessToken (Meta long-lived token exchange, no refresh_token)
 * ✓ ADDED missing redirectUri to getConfig()
 * ✓ Standardized response structure
 * ✓ Added null safety in error handling
 * ✓ Removed messaging/API methods (sendTextMessage, etc.) - see WhatsAppMessagingAPI class
 * ✓ Removed setupChannel - moved to WhatsAppSetupAPI
 * 
 * NOTE: WhatsApp OAuth uses Facebook's long-lived token exchange (fb_exchange_token).
 * Long-lived tokens don't expire (or expire in ~60 days), unlike OAuth 2.0 standard.
 * Messaging APIs and webhook setup are NOT in this class.
 * Use WhatsAppMessagingAPI and WhatsAppSetupAPI for those operations.
 */

export default class OauthWhatsApp extends BaseOAuthProvider {
    name = "whatsapp";

    getConfig() {
        return {
            clientId: wa_client_id,
            clientSecret: wa_client_secret,
            redirectUri: wa_redirect_uri, // FIX: Was missing
        };
    }

    getAuthUrl({ state = "", scopes = [] }) {
        const params = new URLSearchParams({
            client_id: wa_client_id,
            redirect_uri: wa_redirect_uri,
            config_id: process.env.wa_config_id,
            response_type: "code",
            // WhatsApp uses comma-separated scopes
            scope: scopes.join(","),
            state,
        });
        return { AuthUrl: `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params}` };
    }

    async getTokens({ code, waba_id, business_id }) {
        // FIX #1: Validate code parameter
        const validation = this._validateStringParam(code, "code");
        if (validation) return validation;

        try {
            // Step 1: Exchange code for short-lived token
            console.log("Step 1: Exchange code for short-lived token");
            const { data: shortLived } = await axios.get(
                `${BASE_URL}/oauth/access_token`,
                {
                    params: {
                        code,
                        client_id: wa_client_id,
                        client_secret: wa_client_secret,
                    },
                }
            ).catch(error => {
                console.error("Step 1: Error:", error);
                return this._errorResponse("malformed_response", "Failed to obtain short-lived token.", 502);
            });
            // Step 2: Exchange for long-lived token (60+ days, essentially permanent)
            console.log("Step 2: Exchange for long-lived token");
            const { data: longLived } = await axios.get(
                `${BASE_URL}/oauth/access_token`,
                {
                    params: {
                        grant_type: "fb_exchange_token",
                        client_id: wa_client_id,
                        client_secret: wa_client_secret,
                        fb_exchange_token: shortLived.access_token,
                    },
                }
            ).catch(error => {
                console.error("Step 2: Error:", error);
                return this._errorResponse("malformed_response", "Failed to obtain long-lived token.", 502);
            });
            // Step 3: debug tokens for scopes and validity
            console.log("Step 3: Debug tokens for scopes and validity");
            const { data: tokenInfo } = await axios.get(`${BASE_URL}/debug_token`, {
                params: {
                    input_token: longLived.access_token,
                    access_token: `${wa_client_id}|${wa_client_secret}`,
                },
            }).catch(error => {
                console.error("Step 3: Error:", error);
                return this._errorResponse("malformed_response", "Failed to debug longlived access token.", 502);
            });
            const { scopes, user_id } = tokenInfo.data;
            const auth = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${longLived.access_token}` } }
            // step 4: setup webhooks
            console.log("Step 4: Setup webhooks");
            const base = (process.env.WEBHOOKS_URL || "").replace(/\/?$/, "/");
            const webhookData = { override_callback_uri: `${base}webhook/Whatsapp`, verify_token: `LeanOn_Webhook` };
            const { data: webhookResponse } = await axios.post(`${BASE_URL}/${waba_id}/subscribed_apps`, webhookData, auth).catch(error => {
                console.error("Step 4: Error:", error);
                return this._errorResponse("malformed_response", "Failed to setup webhooks.", 502);
            });
            // Step 5: Fetch account details
            console.log("Step 5: Fetch WABA details");
            const { data: wabaDetails } = await axios.get(`${BASE_URL}/${waba_id}`, {
                params: { fields: "id,name,status,country,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status" },
                headers: auth.headers,
            }).catch(error => {
                console.error("Step 5: Error:", error);
                return this._errorResponse("malformed_response", "Failed to fetch WABA details.", 502);
            });
            console.log("Step 6: Fetch business details");
            const { data: businessDetails } = await axios.get(`${BASE_URL}/${business_id}`, {
                headers: auth.headers,
            }).catch(error => {
                console.error("Step 6: Error:", error);
                return this._errorResponse("malformed_response", "Failed to fetch business details.", 502);
            });
            console.log("Step 7: Return success response");
            const credentials = {
                accessToken: longLived.access_token,
                refreshToken: null, // Facebook long-lived tokens don't use refresh tokens
                tokenType: longLived.token_type || "Bearer",
                expiresAt: longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null, // Long-lived tokens don't have meaningful expiry (60+ days typically)
                expiresIn: longLived.expires_in,
                refreshTokenExpiresAt: null,
            };
            console.log("Step 8: Success response");
            return this._successResponse({ credentials, scope: scopes, accountDetails: { business: businessDetails, waba: wabaDetails, token: tokenInfo, webhook: webhookData } });
        } catch (error) {
            console.error("Error:", error);
            return this._handleError(error);
        }
    }
    async setupChannel({ apiAuthenticator, config, runtime }) {
        const { phone_number_id } = config;
        console.log("Step 1: Setup channel");
        const accessToken = apiAuthenticator?.credentials?.accessToken;
        if (!accessToken) return this._errorResponse("missing_credentials", "Missing access token.", 400);
        console.log("Step 2: Access token found");
        const auth = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } };
        const steps = {};
        console.log("Step 3: Steps initialized");
        switch (runtime) {
            case 'REALTIME':
                steps.calling = await this._safeStep("calling", () =>
                    axios.post(`${BASE_URL}/${phone_number_id}/settings`, {
                        calling: {
                            status: "ENABLED",
                            call_icon_visibility: "DEFAULT",
                            callback_permission_status: "ENABLED",
                            audio: { additional_codecs: ["PCMU", "PCMA"] },
                        },
                    }, auth)
                );
                break;
            case 'TURN_BASED':
                steps.registration = await this._safeStep("registration", () =>
                    axios.post(`${BASE_URL}/${phone_number_id}/register`, {
                        messaging_product: "whatsapp",
                        pin: "000000",
                    }, auth),
                    { okErrorCodes: [133016] } // CRITICAL — register number to send and receive messages
                );
                break;
            default:
                return this._errorResponse("invalid_runtime", "Invalid runtime.", 400);
        }
        return this._successResponse(config, { config, externalId: phone_number_id });
    }
    /**
 * Runs one setup step in isolation. Never throws.
 * - optional: failure won't fail the channel (e.g. calling on a low-tier number)
 * - okErrorCodes: Meta error codes to treat as success (idempotency, e.g. "already registered")
 */
    async _safeStep(name, fn, { optional = false, okErrorCodes = [] } = {}) {
        try {
            const res = await fn();
            return { ok: true, name, data: res.data };
        } catch (error) {
            const fbError = error?.response?.data?.error || {};
            const code = fbError.code;

            // Idempotency: some "errors" mean "already in the desired state"
            if (okErrorCodes.includes(code)) {
                return { ok: true, name, idempotent: true, note: fbError.message };
            }

            const detail = {
                ok: false,
                name,
                optional,
                httpStatus: error?.response?.status ?? null,
                code: code ?? null,
                subcode: fbError.error_subcode ?? null,
                message: fbError.message || error.message,
                fbtrace_id: fbError.fbtrace_id ?? null, // give this to Meta support if needed
            };
            console.error(`[setupChannel:${name}] failed`, detail);
            return detail;
        }
    }
    async refreshToken({ accessToken }) {
        // Meta has no refresh_token — extend validity by re-exchanging the long-lived access token
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            const { data } = await axios.get(
                `${BASE_URL}/oauth/access_token`,
                {
                    params: {
                        grant_type: "fb_exchange_token",
                        client_id: wa_client_id,
                        client_secret: wa_client_secret,
                        fb_exchange_token: accessToken,
                    },
                }
            );

            if (!data?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "Failed to refresh token.",
                    502
                );
            }

            const refreshed = {
                accessToken: data.access_token,
                refreshToken: null,
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
                refreshTokenExpiresAt: null,
            };

            return this._successResponse(refreshed);
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getUserInfo({ accessToken }) {
        // FIX: Validate accessToken parameter
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            // Fetch user identity and WhatsApp Business Accounts (WABAs) they have access to
            const { data } = await axios.get(`${BASE_URL}/me`, {
                params: {
                    fields: "id,name",
                },
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 5000,
            });

            if (!data || !data.id) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Meta.",
                    502
                );
            }

            // Fetch the WABAs (WhatsApp Business Accounts) this user has access to
            const wabaResponse = await axios.get(
                `${BASE_URL}/${data.id}/businesses`,
                {
                    params: {
                        fields:
                            "id,name,whatsapp_business_accounts{id,name,timezone_id,message_template_namespace}",
                    },
                    headers: { Authorization: `Bearer ${accessToken}` },
                }
            ).catch(() => ({ data: null }));

            return this._successResponse({
                id: data.id,
                name: data.name,
                businesses: wabaResponse.data?.data || [],
            });
        } catch (error) {
            return this._handleError(error);
        }
    }
    /**
     * OPTIONAL: Get token metadata (validity, scopes, etc.)
     * Provider-specific, not in base interface
     */
    async getTokenInfo({ accessToken }) {
        // FIX: Validate accessToken parameter
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            const appAccessToken = `${wa_client_id}|${wa_client_secret}`;
            const { data } = await axios.get(`${BASE_URL}/debug_token`, {
                params: {
                    input_token: accessToken,
                    access_token: appAccessToken,
                },
            });

            if (!data?.data) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Meta.",
                    502
                );
            }

            const tokenData = data.data;
            return this._successResponse({
                clientId: tokenData.app_id,
                scopes: tokenData.scopes || [],
                expiresIn: tokenData.expires_at
                    ? tokenData.expires_at - Math.floor(Date.now() / 1000)
                    : null,
                isValid: tokenData.is_valid,
                type: tokenData.type,
            });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async resolvePlayableRecordingUrl({ recordingData, credentials }) {
        const { accessToken } = credentials;
        if (!accessToken) return this._errorResponse("missing_credentials", "Missing access token.", 400);
        const { data } = await axios.get(`${BASE_URL}/media/${recordingData.key}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        return { url: data.url, headers: { Authorization: `Bearer ${accessToken}` } };
    }

    async validateToken({ accessToken }) {
        // FIX: ALWAYS return boolean
        if (!accessToken || typeof accessToken !== "string") return false;

        try {
            const appAccessToken = `${wa_client_id}|${wa_client_secret}`;
            const { data } = await axios.get(`${BASE_URL}/debug_token`, {
                params: {
                    input_token: accessToken,
                    access_token: appAccessToken,
                },
                timeout: 5000,
            });
            return data?.data?.is_valid === true;
        } catch {
            return false;
        }
    }
    async teardownChannel({ apiAuthenticator, config }) {
        const { phone_number_id, waba_id } = config || {};
        const accessToken = apiAuthenticator?.credentials?.accessToken;
        if (!accessToken) {
            return this._errorResponse("missing_credentials", "Missing access token.", 400);
        }

        const auth = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } };
        const steps = {};

        // 1) Disable calling first (stops new call webhooks). Optional — number may have none.
        if (phone_number_id) {
            steps.disableCalling = await this._safeStep("disableCalling", () =>
                axios.post(`${BASE_URL}/${phone_number_id}/settings`, {
                    calling: { status: "DISABLED" },
                }, auth),
                { optional: true }
            );

            // 2) Deregister the number. Tolerate "not registered".
            steps.deregister = await this._safeStep("deregister", () =>
                axios.post(`${BASE_URL}/${phone_number_id}/deregister`, {}, auth),
                { optional: true }
            );
        }

        // 3) Unsubscribe our app from this WABA — stops ALL webhooks for it.
        // if (waba_id) {
        //     steps.unsubscribe = await this._safeStep("unsubscribe", () =>
        //         axios.delete(`${BASE_URL}/${waba_id}/subscribed_apps`, auth),
        //         { optional: true }
        //     );
        // }

        const teardown = Object.fromEntries(
            Object.entries(steps).map(([k, v]) => [k, v.ok])
        );

        // Always success: report what cleaned up, but never block channel deletion.
        return this._successResponse({ teardown }, { config: { ...config, teardown } });
    }
    // Template operations
    async listTemplatesLibrary({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const { search, topic, usecase, industry, language, name, limit = 20, afterCursor = null } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/message_template_library`, { params: { search, topic, usecase, industry, language, name, limit, afterCursor }, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async listTemplates({ secrets, parameters = { limit: 20, afterCursor: null, fields: "id,name,status,category,language,components,quality_score,rejected_reason,last_updated_time,source" } }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { limit, afterCursor, fields } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}/message_templates`, { params: { limit, afterCursor, fields, }, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async getTemplate({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { templateId } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}/message_templates/${templateId}`, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async createTemplate({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { body } = parameters;
        try {
            const { data } = await axios.post(`${BASE_URL}/${wabaId}/message_templates`, body, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async updateTemplate({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { updates, templateId } = parameters;
        try {
            const { data } = await axios.post(`${BASE_URL}/${wabaId}/message_templates/${templateId}`, updates, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async deleteTemplate({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { templateId } = parameters;
        try {
            const { data } = await axios.delete(`${BASE_URL}/${wabaId}/message_templates`, { params: { hsm_id: templateId }, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    // Details 
    async getRateLimitUsage({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        try {
            const response = await axios.get(`${BASE_URL}/${wabaId}`, {
                params: { fields: "id" },
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return {
                businessUseCaseUsage: response.headers["x-business-use-case-usage"] ? JSON.parse(response.headers["x-business-use-case-usage"]) : null,
                appUsage: response.headers["x-app-usage"] ? JSON.parse(response.headers["x-app-usage"]) : null,
            };
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getPhoneNumberMetadata({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const phoneNumberId = secrets.channelConfig.phoneNumberId;
        const { fields = "verified_name,code_verification_status,display_phone_number,quality_rating,platform_type,throughput,webhook_configuration,id" } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${phoneNumberId}`, { params: { fields }, headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getWABADetails({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { fields } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}`, {
                params: { fields },
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async getBusinessProfile({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const phoneNumberId = secrets.channelConfig.phoneNumberId;
        const { fields = "about,address,description,email,profile_picture_url,websites,vertical" } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${phoneNumberId}/whatsapp_business_profile`, {
                params: { fields },
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }
    async updateBusinessProfile({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const phoneNumberId = secrets.channelConfig.phoneNumberId;
        const { profile } = parameters;
        try {
            const { data } = await axios.post(`${BASE_URL}/${phoneNumberId}/whatsapp_business_profile`, {
                messaging_product: "whatsapp",
                ...profile,
            }, {
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }


    // Analytics operations
    async getMessagingAnalytics({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { start, end, granularity = "DAY", phoneNumbers, productTypes } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}`, {
                params: {
                    fields: `analytics.start(${start}).end(${end}).granularity(${granularity})${phoneNumbers ? `.phone_numbers(${JSON.stringify(phoneNumbers)})` : ""}${productTypes ? `.product_types(${JSON.stringify(productTypes)})` : ""}`,
                },
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getPricingAnalytics({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { start, end, granularity = "DAY", pricingType } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}`, {
                params: {
                    fields: `pricing_analytics.start(${start}).end(${end}).granularity(${granularity})${pricingType ? `.pricing_type(${pricingType})` : ""}`,
                },
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getTemplateAnalytics({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        const { templateIds, start, end, granularity = "DAILY" } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}/template_analytics`, {
                params: { template_ids: JSON.stringify(templateIds), start, end, granularity },
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }



    // Subscriptions operations
    async listSubscribedApps({ secrets }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        try {
            const { data } = await axios.get(`${BASE_URL}/${wabaId}/subscribed_apps`, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async subscribeApp({ secrets }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        try {
            const { data } = await axios.post(`${BASE_URL}/${wabaId}/subscribed_apps`, {}, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async unsubscribeApp({ secrets }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const wabaId = secrets.channelConfig.wabaId;
        try {
            const { data } = await axios.delete(`${BASE_URL}/${wabaId}/subscribed_apps`, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getCallingSettings({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const { phoneNumberId } = parameters;
        try {
            const { data } = await axios.get(`${BASE_URL}/${phoneNumberId}/settings`, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }

    async updateCallingSettings({ secrets, parameters = {} }) {
        const accessToken = secrets.authentcatorDoc.credentials.accessToken;
        const { phoneNumberId, callingSettings } = parameters;
        try {
            const { data } = await axios.post(`${BASE_URL}/${phoneNumberId}/settings`, { calling: callingSettings }, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` } });
            return data;
        } catch (error) {
            return this._handleError(error);
        }
    }


    listChannelSettingMethods() {
        return [
            {
                name: "listTemplatesLibrary",
                description: "List all templates library",
                parameters: {
                    search: {
                        type: "string",
                        description: "The search query to filter templates",
                    },
                    topic: {
                        type: "string",
                        enum: ["ACCOUNT_UPDATE", "CUSTOMER_FEEDBACK", "ORDER_MANAGEMENT", "PAYMENTS"],
                        description: "The topic to filter templates",
                    },
                    usecase: {
                        type: "string",
                        enum: ["ACCOUNT_CREATION_CONFIRMATION", "AUTO_PAY_REMINDER", "DELIVERY_CONFIRMATION", "DELIVERY_FAILED", "DELIVERY_UPDATE", "FEEDBACK_SURVEY", "FRAUD_ALERT", "LOW_BALANCE_WARNING", "ORDER_ACTION_NEEDED", "ORDER_CONFIRMATION", "ORDER_DELAY", "ORDER_OR_TRANSACTION_CANCEL", "ORDER_PICK_UP", "PAYMENT_ACTION_REQUIRED", "PAYMENT_CONFIRMATION", "PAYMENT_DUE_REMINDER", "PAYMENT_OVERDUE", "PAYMENT_REJECT_FAIL", "PAYMENT_SCHEDULED", "RECEIPT_ATTACHMENT", "RETURN_CONFIRMATION", "SHIPMENT_CONFIRMATION", "STATEMENT_ATTACHMENT", "STATEMENT_AVAILABLE", "TRANSACTION_ALERT"],
                        description: "The use case to filter templates",
                    },
                    industry: {
                        type: "array",
                        enum: ["E_COMMERCE", "FINANCIAL_SERVICES"],
                        description: "The industry to filter templates",
                    },
                    language: {
                        type: "string",
                        enum: ["af", "sq", "ar", "ar_EG", "ar_AE", "ar_LB", "ar_MA", "ar_QA", "az", "be_BY", "bn", "bn_IN", "bg", "ca", "zh_CN", "zh_HK", "zh_TW", "hr", "cs", "da", "prs_AF", "nl", "nl_BE", "en", "en_GB", "en_US", "en_AE", "en_AU", "en_CA", "en_GH", "en_IE", "en_IN", "en_JM", "en_MY", "en_NZ", "en_QA", "en_SG", "en_UG", "en_ZA", "et", "fil", "fi", "fr", "fr_BE", "fr_CA", "fr_CH", "fr_CI", "fr_MA", "ka", "de", "de_AT", "de_CH", "el", "gu", "ha", "he", "hi", "hu", "id", "ga", "it", "ja", "kn", "kk", "rw_RW", "ko", "ky_KG", "lo", "lv", "lt", "mk", "ms", "ml", "mr", "nb", "ps_AF", "fa", "pl", "pt_BR", "pt_PT", "pa", "ro", "ru", "sr", "si_LK", "sk", "sl", "es", "es_AR", "es_CL", "es_CO", "es_CR", "es_DO", "es_EC", "es_HN", "es_MX", "es_PA", "es_PE", "es_ES", "es_UY", "sw", "ny", "xh", "zu", "en_GB", "en_AU", "en_CA", "en_NZ", "en_ZA", "en_IN", "en_IE", "en_PH", "en_SG", "en_HK", "en_MO"],
                        description: "The language to filter templates ,refer to https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages ",
                    },
                    name: {
                        type: "string",
                        description: "The name of the template to filter templates",
                    },
                    limit: {
                        type: "number",
                        description: "The limit of the templates to list",
                        default: 20,
                    },
                    afterCursor: {
                        type: "string",
                        description: "The cursor to the next page of templates",
                    },
                },
                returns: {
                    type: "object",
                    properties: {
                        data: {
                            type: "array",
                            description: "The list of templates library",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    name: { type: "string" },
                                    status: { type: "string" },
                                    category: { type: "string" },
                                    topic: { type: "string" },
                                    usecase: { type: "string" },
                                    industry: { type: "array" },
                                    header: { type: "string" },
                                    body: { type: "string" },
                                    body_params: { type: "array" },
                                    body_param_types: { type: "array" },
                                    buttons: { type: "array" }
                                },
                            }
                        },
                        paging: {
                            type: "object",
                            properties: {
                                cursors: {
                                    type: "object",
                                    properties: {
                                        before: { type: "string" },
                                        after: { type: "string" },
                                    },
                                },
                                next: { type: "string" },
                            },
                        }
                    }

                },
            },
            {
                name: "listTemplates",
                description: "List all templates",
                parameters: {
                    limit: {
                        type: "number",
                        description: "The limit of the templates to list",
                        default: 20,
                    },
                    afterCursor: {
                        type: "string",
                        description: "The cursor to the next page of templates",
                    },
                    fields: {
                        type: "string",
                        description: "The fields to return",
                        default: "id,name,status,category,language,components,quality_score,rejected_reason,last_updated_time,source",
                    },
                },
                returns: {
                    type: "array",
                    description: "The list of templates",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            name: { type: "string" },
                            status: { type: "string" },
                            category: { type: "string" },
                            language: { type: "string" },
                            components: { type: "array" },
                            quality_score: { type: "number" },
                            rejected_reason: { type: "string" },
                            last_updated_time: { type: "string" },
                            source: { type: "string" },
                        },
                    },
                },
            },
            {
                name: "getTemplate",
                description: "Get a template by ID",
                parameters: {
                    templateId: {
                        type: "string",
                        description: "The ID of the template to get",
                    },
                },
                returns: {
                    type: "object",
                    description: "The template",
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        status: { type: "string" },
                        category: { type: "string" },
                        language: { type: "string" },
                        components: { type: "array" },
                    },
                },
            },
            {
                name: "createTemplate",
                description: "Create a new template",
                parameters: {
                    body: {
                        type: "object",
                        description: "The body of the template to create",
                    },
                },
                returns: {
                    type: "object",
                    description: "The created template",
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                    },
                    status: { type: "string" },
                    category: { type: "string" },
                    language: { type: "string" },
                    components: { type: "array" },
                    quality_score: { type: "number" },
                    rejected_reason: { type: "string" },
                    last_updated_time: { type: "string" },
                    source: { type: "string" },
                    created_time: { type: "string" },
                    updated_time: { type: "string" },
                    deleted_time: { type: "string" },
                    deleted: { type: "boolean" },
                    deleted_reason: { type: "string" },
                    deleted_reason_code: { type: "string" },
                    deleted_reason_description: { type: "string" },
                },
            },
            {
                name: "updateTemplate",
                description: "Update a template by ID",
                parameters: {
                    templateId: {
                        type: "string",
                        description: "The ID of the template to update",
                    },
                    updates: {
                        type: "object",
                        description: "The updates to the template",
                    },
                },
                returns: {
                    type: "object",
                    description: "The updated template",
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        status: { type: "string" },
                        category: { type: "string" },
                        language: { type: "string" },
                        components: { type: "array" },
                    },
                },
            },
            {
                name: "deleteTemplate",
                description: "Delete a template by ID",
                parameters: {
                    templateId: {
                        type: "string",
                        description: "The ID of the template to delete",
                    },
                },
                returns: {
                    type: "object",
                    description: "The deleted template",
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        status: { type: "string" },
                        category: { type: "string" },
                        language: { type: "string" },
                        components: { type: "array" },
                    },
                },
            },

        ];
    }
    _handleError(error) {
        // FIX: Handle case where response is null/undefined (network error)
        const response = error.response;

        if (!response) {
            return this._errorResponse(
                "network_error",
                "Unable to reach Meta authentication servers.",
                503
            );
        }

        const status = response.status;
        const fbError = response.data?.error || {};

        switch (status) {
            case 400:
                return this._errorResponse(
                    this._extractErrorCode(fbError, "invalid_request"),
                    this._extractErrorMessage(fbError, "Bad request."),
                    400
                );
            case 401:
                return this._errorResponse(
                    this._extractErrorCode(fbError, "invalid_token"),
                    this._extractErrorMessage(
                        fbError,
                        "The token is expired or invalid."
                    ),
                    401
                );
            case 403:
                return this._errorResponse(
                    "permission_denied",
                    this._extractErrorMessage(
                        fbError,
                        "Missing required permissions."
                    ),
                    403
                );
            case 429:
                return this._errorResponse(
                    "rate_limit_exceeded",
                    "Too many requests to Meta servers.",
                    429
                );
            default:
                return this._errorResponse(
                    "provider_error",
                    `Meta OAuth error (${status})`,
                    status || 503
                );
        }
    }
}
