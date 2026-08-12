import axios from "axios";
import BaseOAuthProvider from "./base.js";
const SUBDOMAIN_MAP = {
    singapore: "api.exotel.com",       // my.exotel.com accounts
    mumbai: "api.in.exotel.com",       // my.mum1.exotel.com accounts
};

function buildBaseUrl(subdomain) {
    return `https://${subdomain}`;
}

function basicAuth(apiKey, apiToken) {
    return `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString("base64")}`;
}

export default class OauthExotel extends BaseOAuthProvider {
    name = "exotel";

    getConfig() {
        return {};
    }

    // Exotel has no OAuth — credentials are static (apiKey + apiToken + accountSid + subdomain).
    // getAuthUrl is not applicable; the UI should collect these four fields directly.
    getAuthUrl({ state = "" }) {
        return {
            AuthUrl: `https://www.avakado.ai/integrate/exotel?state=${state}`,
            ExpectedKeysFromQuery: {
                type: "object",
                required: ["apiKey", "apiToken", "accountSid", "region", "scope"],
                properties: {
                    apiKey: {
                        "type": "string",
                        description: "Exotel API Key",
                        minLength: 1,
                        xUi: {
                            label: "API Key",
                            inputType: "password",
                            sensitive: true,
                            placeholder: "e.g. a1b2c3d4e5f6",
                            helpText: "Exotel Dashboard → Settings → API Settings",
                            helpLink: "https://my.exotel.com"
                        }
                    },
                    apiToken: {
                        type: "string",
                        description: "Exotel API Token",
                        minLength: 1,
                        xUi: {
                            label: "API Token",
                            inputType: "password",
                            sensitive: true,
                            placeholder: "e.g. 9f8e7d6c5b4a",
                            helpText: "Paired secret shown alongside the API Key on the same Settings page."
                        }
                    },
                    accountSid: {
                        type: "string",
                        description: "Exotel Account SID",
                        minLength: 1,
                        xUi: {
                            label: "Account SID",
                            inputType: "text",
                            sensitive: false,
                            placeholder: "e.g. yourcompany1a2b3c",
                            helpText: "Also found on the API Settings page — not the same as your login username."
                        }
                    },
                    region: {
                        type: "string",
                        description: "Exotel Region",
                        default: "Singapore",
                        enum: ["Singapore", "Mumbai"],
                        xUi: {
                            label: "Data Center",
                            inputType: "select",
                            options: [
                                { value: "Singapore", label: "Singapore (Global)" },
                                { value: "Mumbai", label: "India (Mumbai)" }
                            ],
                            helpText: "Pick the data center your Exotel account was provisioned in. This determines which host every API call is routed to.",
                            mapsTo: {
                                subdomain: { Singapore: "api.exotel.com", Mumbai: "api.in.exotel.com" },
                                ccmSubdomain: { Singapore: "ccm-api.exotel.com", Mumbai: "ccm-api.in.exotel.com" }
                            }
                        }
                    },
                    scope: {
                        type: "array",
                        description: "Exotel Scopes",
                        items: {
                            type: "string",
                            enum: ["voice_calling", "exophones_manage", "ccm_agent_context"]
                        },
                        default: ["voice_calling", "exophones_manage"],
                        xUi: {
                            label: "Enable capabilities",
                            inputType: "multi-select",
                            options: [
                                { value: "voice_calling", label: "Voice — make/receive calls, call reporting" },
                                { value: "exophones_manage", label: "Phone Numbers — browse, purchase, configure ExoPhones" },
                                { value: "ccm_agent_context", label: "Agent Calling (deprecated) — CCM agent-to-customer calls" }
                            ],
                            helpText: "Application-level gating only — Exotel itself does not scope API keys; this just controls which of your app's Exotel actions this credential set is allowed to power."
                        }
                    }
                },
                additionalProperties: false
            }
        };
    }

    // Validates the credentials by hitting a lightweight Exotel endpoint.
    // ExpectedKeysFromQuery: ['apiKey', 'apiToken', 'accountSid', 'region']
    // region: 'singapore' | 'mumbai'  (defaults to 'singapore')
    async getTokens({ apiKey, apiToken, accountSid, region = "singapore", scope = [] }) {
        if (!apiKey || !apiToken || !accountSid) {
            return this._errorResponse("missing_credentials", "apiKey, apiToken, and accountSid are required.", 400);
        }
        const subdomain = SUBDOMAIN_MAP[region] || SUBDOMAIN_MAP.singapore;
        try {
            const { data: accountDetails } = await axios.get(`https://api.exotel.com/v1/Accounts/${accountSid}.json`, {
                headers: {
                    'Authorization': basicAuth(apiKey, apiToken)
                }
            });
            console.log("accountDetails", accountDetails);
            // expect 
            // { Sid: 'onewindowoverseaseducation1', FriendlyName: 'One Window Overseas Education', Type: 'Full', Status: 'active', DateCreated: '2025-05-16 17:27:41', DateUpdated: '2025-11-07 15:20:11', Uri: null, BillingType: 'prepaid', KycStatus: 'completed' }
            // Lightweight validation: list calls (empty is fine, 200 = credentials valid)
            // await axios.get(`${buildBaseUrl(subdomain)}/v1/Accounts/${accountSid}/Calls.json?PageSize=1`, { headers: { Authorization: basicAuth(apiKey, apiToken) } });
            return this._successResponse({ credentials: { apiKey, apiToken, accountSid, subdomain }, scope: scope, accountDetails: accountDetails });
        } catch (error) {
            return this._handleError(error);
        }
    }

    // Sets up inbound call/SMS webhook for the given Exotel virtual number (exophone).
    // config must include: { exophone, appId, capabilities }  — the DID/Exophone to attach the webhook to and the appId to use and the options to use
    async setupChannel({ apiAuthenticator, channelId, config }) {
        const webhookUrl = `https://app.avakado.ai/exotel-redirect?channelId=${channelId}`;
        const { apiKey, apiToken, accountSid, subdomain } = apiAuthenticator.credentials;
        let { exophone, exophoneSid = null, appId, capabilities } = config; // capabilities = { voice: true, sms: true, friendlyName: "Exotel Voice App" }
        if (!exophone) return this._errorResponse("missing_exophone", "config.exophone (DID number) is required.", 400);
        try {
            if (!exophoneSid) {
                const { data: { incoming_phone_numbers } } = await axios.get(`https://${apiKey}:${apiToken}@${subdomain}/v2_beta/Accounts/${accountSid}/IncomingPhoneNumbers.json`);
                exophoneSid = incoming_phone_numbers.filter(number => number.phone_number === exophone)[0].sid;
                if (!exophoneSid) return this._errorResponse("exophone_not_found", "Exophone not found.", 400);
            }
            const body = new URLSearchParams({
                ...(capabilities.voice && { VoiceUrl: `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}` }),
                ...(capabilities.sms && { SMSUrl: `http://my.exotel.com/${accountSid}/exoml/start_sms/${appId}` }),
                ...(capabilities.friendlyName && { FriendlyName: capabilities.friendlyName }),
            });
            try {
                const { data } = await axios.put(`https://${apiKey}:${apiToken}@${subdomain}/v2_beta/Accounts/${accountSid}/IncomingPhoneNumbers/${exophoneSid}.json`,
                    body,
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        }
                    });
            } catch (error) {
                const responseData = error?.response?.data;
                let message;
                if (typeof responseData === "string") {
                    message = responseData;
                } else if (responseData && typeof responseData === "object") {
                    // Exotel typically nests errors under RestException
                    message =
                        responseData.RestException?.Message ||
                        responseData.message ||
                        JSON.stringify(responseData);
                } else {
                    message = error.message || "Unknown error";
                }

                throw new Error(`Failed to assign phone number to flow: ${message}`);
            }
            return { success: true, config: { ...config, webhookUrl: webhookUrl }, error: null, externalId: exophone }
        } catch (error) {
            console.log("error", error);
            return this._handleError(error);
        }
    }

    async getUserInfo({ apiKey, apiToken, accountSid, subdomain = SUBDOMAIN_MAP.singapore }) {
        if (!apiKey || !apiToken || !accountSid) {
            return this._errorResponse("missing_credentials", "apiKey, apiToken, and accountSid are required.", 400);
        }
        try {
            // Fetch account-level info via the Calls list (lightest endpoint that confirms identity)
            const { data } = await axios.get(
                `${buildBaseUrl(subdomain)}/v1/Accounts/${accountSid}/Calls.json?PageSize=1`,
                { headers: { Authorization: basicAuth(apiKey, apiToken) } }
            );
            return this._successResponse({ credentials: { accountSid, subdomain, ...data }, accountDetails: { accountSid, subdomain, ...data } });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getTokenInfo({ apiKey, apiToken, accountSid, subdomain = SUBDOMAIN_MAP.singapore }) {
        if (!apiKey || !apiToken || !accountSid) {
            return this._errorResponse("missing_credentials", "apiKey, apiToken, and accountSid are required.", 400);
        }
        try {
            await axios.get(
                `${buildBaseUrl(subdomain)}/v1/Accounts/${accountSid}/Calls.json?PageSize=1`,
                { headers: { Authorization: basicAuth(apiKey, apiToken) } }
            );
            return this._successResponse({ credentials: { clientId: accountSid, scopes: [], expiresIn: null, isValid: true } });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async validateToken({ apiKey, apiToken, accountSid }) {
        // Static credentials — no expiry or refresh flow
        return Boolean(apiKey && apiToken && accountSid);
    }

    _handleError(error) {
        // FIX: Handle case where response is null/undefined (network error)
        const response = error.response;

        if (!response) {
            return this._errorResponse(
                "network_error",
                "Unable to reach Exotel authentication servers.",
                503
            );
        }

        const status = response.status;
        const errorData = response.data || {};

        switch (status) {
            case 400:
                return this._errorResponse(
                    this._extractErrorCode(errorData, "invalid_grant"),
                    this._extractErrorMessage(
                        errorData,
                        "The token is invalid or has already been used. For OAuth 2.1 refresh token rotation, this means the refresh token was already consumed."
                    ),
                    400
                );
            case 401:
                return this._errorResponse(
                    "unauthorized",
                    "Access token is expired or invalid.",
                    401
                );
            case 403:
                return this._errorResponse(
                    "forbidden",
                    "Insufficient permissions or missing required scopes.",
                    403
                );
            case 429:
                return this._errorResponse(
                    "rate_limit_exceeded",
                    "Too many requests. Respect the Retry-After header before retrying.",
                    429
                );
            default:
                return this._errorResponse(
                    "provider_error",
                    `Exotel error (${status})`,
                    status || 503
                );
        }
    }
};