import { Telegraf } from "telegraf";
import BaseOAuthProvider from "./base.js";
export default class OauthTelegram extends BaseOAuthProvider {
    name = "telegram";
    async getAuthUrl({ state = "" }) {
        return {
            ExpectedKeysFromQuery: {
                type: "object",
                required: ["apiToken"],
                properties: {
                    apiToken: { type: "string", description: "Telegram API Token" }
                },
                additionalProperties: false
            }, AuthUrl: `https://www.avakado.ai/integrate/telegram?state=${state}`
        };
    }
    async getTokens({ apiToken }) {
        if (!apiToken || typeof apiToken !== "string") return this._errorResponse("missing_apiToken", "An apiToken string is required.", 400);
        try {
            const client = new Telegraf(apiToken);
            const botInfo = await client.telegram.getMe();
            return this._successResponse({ credentials: { apiToken }, accountDetails: botInfo });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async getUserInfo({ apiToken }) {
        if (!apiToken || typeof apiToken !== "string") return this._errorResponse("missing_token", "An access token string is required.", 400);
        try {
            const client = new Telegraf(apiToken);
            const botInfo = await client.telegram.getMe();
            return this._successResponse(botInfo, { accountDetails: botInfo, config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async setupChannel({ apiAuthenticator, providerName, channelId }) {
        let webhookUrl = `${process.env.WEBHOOKS_URL}webhook/${providerName}/${channelId}`
        const { apiToken } = apiAuthenticator.credentials;
        try {
            const client = new Telegraf(apiToken);
            await client.telegram.setWebhook(webhookUrl);
            return this._successResponse({ webhookUrl }, { config: { webhookUrl }, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async getTokenInfo({ apiToken }) {
        if (!apiToken || typeof apiToken !== "string") {
            return this._errorResponse("missing_token", "An apiToken string is required.", 400);
        }
        try {
            const client = new Telegraf(apiToken);
            const botInfo = await client.telegram.getMe();
            return this._successResponse({ clientId: String(botInfo.id), scopes: [], expiresIn: null, isValid: true, botInfo }, { accountDetails: botInfo, config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    async validateToken({ apiToken }) {
        // Bot tokens do not expire — no refresh flow
        return Boolean(apiToken && typeof apiToken === "string");
    }

    /** ----------------------------
     *  Webhook management
     * -----------------------------*/

    async getWebhookInfo({ apiToken }) {
        try {
            const client = new Telegraf(apiToken);
            const info = await client.telegram.getWebhookInfo();
            return this._successResponse(info, { accountDetails: info, config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async deleteWebhook({ apiToken, dropPendingUpdates = false }) {
        try {
            const client = new Telegraf(apiToken);
            await client.telegram.deleteWebhook({ drop_pending_updates: dropPendingUpdates });
            return this._successResponse({ success: true }, { config: {}, scope: [] });
        } catch (error) {
            return this._handleError(error);
        }
    }
    _botResult(data) {
        if (!data?.ok) {
            return this._errorResponse("telegram_api_error", data?.description || "Telegram API returned ok:false.", 400);
        }
        return this._successResponse(data.result);
    }
    _handleError(error) {
        const resp = error?.response;
        const status = resp?.status || resp?.error_code || error?.code;
        const description =
            resp?.data?.description || resp?.description || error?.description || error?.message;

        if (!status) {
            return this._errorResponse("network_error", `Unable to reach ${this.name} servers.`, 503);
        }

        const map = {
            400: ["invalid_request", "Bad request."],
            401: ["invalid_token", "The bot token is invalid or has been revoked."],
            403: ["forbidden", "The bot lacks permission for this action."],
            429: ["rate_limit_exceeded", "Too many requests to Telegram servers."],
        };
        const [code, fallback] = map[status] || ["provider_error", `Telegram error (${status}).`];
        return this._errorResponse(code, description || fallback, status);
    }
};