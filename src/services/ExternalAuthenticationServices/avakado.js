import axios from "axios";
import BaseOAuthProvider from "./base.js";
export default class OauthAvakado extends BaseOAuthProvider {
    name = "avakado";

    getConfig() {
        return {};
    }
    getAuthUrl({ state = "" }) {
        return {
            AuthUrl: `https://www.avakado.ai/integrate/avakado?state=${state}`,
            ExpectedKeysFromQuery: {
                type: "object",
                required: ["expiry", "scope", "accessToken"],
                properties: {
                    expiry: {
                        type: "string",
                        description: "Expiry",
                        default: "30d",
                        xUi: {
                            label: "Expiry",
                            inputType: "text",
                        }
                    },
                    accessToken: {
                        type: "string",
                        description: "Access Token",
                        default: "",
                        xUi: {
                            label: "Access Token",
                            inputType: "password",
                        }
                    },
                    scope: {
                        type: "array",
                        description: "Avakado Scopes",
                        items: {
                            type: "string",
                            // enum: ["", "", ""]
                        },
                        // default: ["", ""],
                        xUi: {
                            label: "Enable capabilities",
                            inputType: "multi-select",
                            options: [
                                // { value: "", label: "" },
                            ],
                            helpText: "Application-level gating only - this is used to control the capabilities of the authenticattion key"
                        }
                    }
                },
                additionalProperties: false
            }
        };
    }

    async getTokens({ expiry, scope, accessToken }) {
        try {
            return this._successResponse({ credentials: { expiry, scope, accessToken } });
        } catch (error) {
            return this._handleError(error);
        }
    }

    // async setupChannel({ apiAuthenticator, channelId, config }) {
    //     const webhookUrl = `https://sockets.avakado.ai/exotel-redirect?channelId=${channelId}`;
    //     const { apiKey, apiToken, accountSid, subdomain } = apiAuthenticator.credentials;
    //     let { exophone, exophoneSid = null, appId, capabilities } = config; // capabilities = { voice: true, sms: true, friendlyName: "Exotel Voice App" }
    //     if (!exophone) return this._errorResponse("missing_exophone", "config.exophone (DID number) is required.", 400);
    //     try {
    //         if (!exophoneSid) {
    //             const { data: { incoming_phone_numbers } } = await axios.get(`https://${apiKey}:${apiToken}@${subdomain}/v2_beta/Accounts/${accountSid}/IncomingPhoneNumbers.json`);
    //             exophoneSid = incoming_phone_numbers.filter(number => number.phone_number === exophone)[0].sid;
    //             if (!exophoneSid) return this._errorResponse("exophone_not_found", "Exophone not found.", 400);
    //         }
    //         const body = new URLSearchParams({
    //             ...(capabilities.voice && { VoiceUrl: `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}` }),
    //             ...(capabilities.sms && { SMSUrl: `http://my.exotel.com/${accountSid}/exoml/start_sms/${appId}` }),
    //             ...(capabilities.friendlyName && { FriendlyName: capabilities.friendlyName }),
    //         });
    //         try {
    //             const { data } = await axios.put(`https://${apiKey}:${apiToken}@${subdomain}/v2_beta/Accounts/${accountSid}/IncomingPhoneNumbers/${exophoneSid}.json`,
    //                 body,
    //                 {
    //                     headers: {
    //                         'Content-Type': 'application/x-www-form-urlencoded',
    //                     }
    //                 });
    //         } catch (error) {
    //             const responseData = error?.response?.data;
    //             let message;
    //             if (typeof responseData === "string") {
    //                 message = responseData;
    //             } else if (responseData && typeof responseData === "object") {
    //                 // Exotel typically nests errors under RestException
    //                 message =
    //                     responseData.RestException?.Message ||
    //                     responseData.message ||
    //                     JSON.stringify(responseData);
    //             } else {
    //                 message = error.message || "Unknown error";
    //             }

    //             throw new Error(`Failed to assign phone number to flow: ${message}`);
    //         }
    //         return { success: true, config: { ...config, webhookUrl: webhookUrl }, error: null, externalId: exophone }
    //     } catch (error) {
    //         console.log("error", error);
    //         return this._handleError(error);
    //     }
    // }

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

