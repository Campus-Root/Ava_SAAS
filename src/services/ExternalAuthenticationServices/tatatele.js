import axios from "axios";
import BaseOAuthProvider from "./base.js";
// Smartflo / Tata Tele Business Services — CPaaS provider
// Auth: Bearer token generated from the Smartflo portal (API Connect → API Tokens).
// Portal-generated tokens never expire. API-generated tokens expire in 60 min.
// Base URL: https://api-smartflo.tatateleservices.com

const BASE_URL = "https://api-smartflo.tatateleservices.com";

function authHeaders(apiToken) {
    return { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", accept: "application/json" };
}

export default class OauthTataTele extends BaseOAuthProvider {
    name = "tatatele";
    getConfig() {
        return {};
    }
    // Smartflo does not use OAuth. Tokens are manually generated in the Smartflo portal.
    // The UI should collect: apiToken and apiKey from API Connect → API Tokens.
    async getAuthUrl({ state = "" }) {
        return {
            AuthUrl: `https://www.avakado.ai/integrate/tatatele?state=${state}`, ExpectedKeysFromQuery: {
                type: "object",
                required: ["apiToken", "apiKey"],
                properties: {
                    apiToken: {
                        type: "string",
                        description: "Smartflo API Token"
                    },
                    apiKey: {
                        type: "string",
                        description: "Smartflo API Key"
                    }
                },
                additionalProperties: false
            }
        };
    }

    // Validates the static bearer token by fetching live/active calls (lightweight endpoint).
    // ExpectedKeysFromQuery: ['apiToken', 'apiKey']
    async getTokens({ apiToken, apiKey }) {
        const tokenValidation = this._validateStringParam(apiToken, "apiToken");
        if (tokenValidation) return tokenValidation;
        const keyValidation = this._validateStringParam(apiKey, "apiKey");
        if (keyValidation) return keyValidation;
        try {
            const { data: accountDetails } = await axios.get(`${BASE_URL}/v1/live_calls`, {
                headers: authHeaders(apiToken),
            });
            return this._successResponse({ credentials: { apiToken, apiKey }, accountDetails });
        } catch (error) {
            return this._handleError(error);
        }
    }

    // Registers the inbound webhook for the given DID number (pilot number).
    // Smartflo webhooks are configured via the portal (API Connect → Webhook), but this
    // method calls the webhook management REST endpoint where available.
    // config must include: { didNumber } — the pilot/DID number to receive inbound calls
    async setupChannel({ apiAuthenticator, providerName, channelId, config }) {
        const webhookUrl = `${process.env.WEBHOOKS_URL}webhook/${providerName}/${channelId}`;
        const { apiToken } = apiAuthenticator.credentials;
        const { didNumber } = config;

        if (!didNumber) return this._errorResponse("missing_didNumber", "config.didNumber (pilot number) is required.", 400);

        try {
            // Smartflo webhooks are primarily configured through the portal.
            // However, the broadcast and call APIs accept a per-request statusCallback.
            // For programmatic webhook registration we register via the CDR/webhook endpoint.
            // NOTE: Contact TTBS support (SR) to enable webhook API for your account.
            await axios.post(`${BASE_URL}/v1/webhook`, {
                name: `Channel_${channelId}`,
                url: webhookUrl,
                trigger: "Call hangup (Missed or Answered)",
                request: "POST",
                call_type: "Inbound",
                content_type: "application/json",
                my_numbers: [didNumber],
            }, { headers: authHeaders(apiToken) });

            return this._successResponse({ ...config, webhookUrl, didNumber }, { config: { ...config, webhookUrl, didNumber }, scope: [] });
        } catch (error) {
            // Webhook API may not be enabled — return success with manual setup note
            console.warn("Smartflo webhook registration failed (may require SR to enable):", error);
            return this._handleError(error);
        }
    }

    async getUserInfo({ apiToken }) {
        if (!apiToken || typeof apiToken !== "string") {
            return this._errorResponse("missing_token", "apiToken is required.", 400);
        }
        try {
            // /v1/live_calls is the lightest authenticated endpoint available
            const { data } = await axios.get(`${BASE_URL}/v1/live_calls`, { headers: authHeaders(apiToken) });
            return this._successResponse(data, { accountDetails: data, config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getTokenInfo({ apiToken }) {
        if (!apiToken || typeof apiToken !== "string") {
            return this._errorResponse("missing_token", "apiToken is required.", 400);
        }
        try {
            await axios.get(`${BASE_URL}/v1/live_calls`, { headers: authHeaders(apiToken) });
            return this._successResponse({ clientId: null, scopes: [], expiresIn: null, isValid: true }, { config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async validateToken({ apiToken }) {
        // Portal-generated tokens do not expire — no refresh flow
        return Boolean(apiToken && typeof apiToken === "string");
    }

    _handleError(error) {
        const response = error.response;
        const msg = response?.data?.message || response?.data?.error;
        switch (response?.status) {
            case 400: return this._errorResponse("invalid_request", msg || "Bad request.", 400);
            case 401: return this._errorResponse("invalid_token", "The API token is invalid or has expired.", 401);
            case 403: return this._errorResponse("permission_denied", msg || "Token lacks required scope or IP is not whitelisted.", 403);
            case 404: return this._errorResponse("not_found", msg || "Resource not found.", 404);
            case 429: return this._errorResponse("rate_limit_exceeded", "Too many requests to Smartflo.", 429);
            default: return this._errorResponse("provider_error", "Unable to reach Smartflo servers.", response?.status || 503);
        }
    }
};