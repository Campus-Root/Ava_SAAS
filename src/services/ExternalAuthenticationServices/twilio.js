import axios from "axios";
import BaseOAuthProvider from "./base.js";
const { TWILIO_AUTH_TOKEN, TWILIO_CONNECT_APP_SID, TWILIO_REDIRECT_URI } = process.env;
import twilio from 'twilio';

// Twilio uses Basic Auth (AccountSid:AuthToken) rather than OAuth2.
// There is no auth URL or token exchange flow — credentials are static
// and issued directly from the Twilio Console. This provider validates,
// normalises, and wraps those credentials in the same interface shape
// as OAuth providers so the rest of the system can treat them uniformly.

const BASE_URL = "https://api.twilio.com/2010-04-01";

function buildBasicToken(accountSid, authToken) {
    return Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

async function getTwilioClient(AccountSid) {
    return twilio(AccountSid, TWILIO_AUTH_TOKEN);
}
export default class OauthTwilio extends BaseOAuthProvider {
    name = "twilio"

    getConfig() {
        return { authToken: TWILIO_AUTH_TOKEN, };
    }
    async getAuthUrl({ state = "" }) {
        const params = new URLSearchParams({ redirectUri: TWILIO_REDIRECT_URI, ...(state && { state }), });
        return { ExpectedKeysFromQuery: null, AuthUrl: `https://www.twilio.com/authorize/${TWILIO_CONNECT_APP_SID}?${params}` }
    }
    async getTokens({ AccountSid }) {
        if (!AccountSid) return this._errorResponse("missing_account_sid", "accountSid is required.", 400);
        try {
            const { data: accountDetails } = await axios.get(`${BASE_URL}/Accounts/${AccountSid}.json`, { headers: { Authorization: `Basic ${buildBasicToken(AccountSid, TWILIO_AUTH_TOKEN)}` } });
            return this._successResponse({ credentials: { id: AccountSid, basicToken: buildBasicToken(AccountSid, TWILIO_AUTH_TOKEN) }, accountDetails });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async setupChannel({ apiAuthenticator, providerName, channelId, config }) {
        let smswebhookUrl = `${process.env.WEBHOOKS_URL}webhook/${providerName}/${channelId}`
        let voicewebhookUrl = `${process.env.VoiceCallWebhookUrl}/twilio-redirect/${channelId}`
        const { PhoneNumberSid } = config
        const { id: AccountSid } = apiAuthenticator.credentials;
        try {
            const client = twilio(AccountSid, TWILIO_AUTH_TOKEN);
            const inboundPhoneNumber = await client.updatePhoneNumber(PhoneNumberSid, {
                voiceUrl: voicewebhookUrl,
                smsUrl: smswebhookUrl,
            })
            return this._successResponse({ ...config, ...inboundPhoneNumber }, { config: { ...config, ...inboundPhoneNumber }, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async getUserInfo({ basicToken }) {
        if (!basicToken || typeof basicToken !== "string") return this._errorResponse("missing_token", "A basicToken string is required.", 400);
        try {
            // Decode the SID from the basic token so we can hit the right account endpoint.
            const decoded = Buffer.from(basicToken, "base64").toString("utf8");
            const accountSid = decoded.split(":")[0];

            const { data } = await axios.get(`${BASE_URL}/Accounts/${accountSid}.json`, {
                headers: { Authorization: `Basic ${basicToken}` },
            });
            if (!data) return this._errorResponse("malformed_response", "Invalid response from Twilio.", 502);
            return this._successResponse(data, { accountDetails: data, config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async getTokenInfo({ basicToken }) {
        if (!basicToken || typeof basicToken !== "string") return this._errorResponse("missing_token", "A basicToken string is required.", 400);
        try {
            const decoded = Buffer.from(basicToken, "base64").toString("utf8");
            const accountSid = decoded.split(":")[0];

            const { data } = await axios.get(`${BASE_URL}/Accounts/${accountSid}.json`, {
                headers: { Authorization: `Basic ${basicToken}` },
            });
            if (!data) return this._errorResponse("malformed_response", "Invalid response from Twilio.", 502);
            return this._successResponse({ clientId: data.sid, scopes: [], expiresIn: null, isValid: data.status === "active" }, { accountDetails: data, config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async validateToken({ basicToken }) {
        // Static basic auth — no expiry or refresh flow
        return Boolean(basicToken && typeof basicToken === "string");
    }
    _handleError(error) {
        const response = error.response;
        const twilioCode = response?.data?.code;
        const twilioMessage = response?.data?.message;
        switch (response?.status) {
            case 400: return this._errorResponse(twilioCode || "invalid_request", twilioMessage || "Bad request.", 400);
            case 401: return this._errorResponse("invalid_credentials", "The AccountSid or AuthToken provided is incorrect.", 401);
            case 403: return this._errorResponse("permission_denied", twilioMessage || "Your account does not have permission to perform this action.", 403);
            case 404: return this._errorResponse("not_found", twilioMessage || "The requested resource does not exist.", 404);
            case 429: return this._errorResponse("rate_limit_exceeded", "Too many requests to Twilio servers.", 429);
            default: return this._errorResponse("provider_error", "Unable to reach Twilio servers.", response?.status || 503);
        }
    }
};