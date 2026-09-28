import axios from "axios";
import BaseOAuthProvider from "./base.js";
import { OAuthClient } from "@avakado.ai/schemas";
import { clientIdFromUserId, findActiveClient } from "../oauthService.js";

const OAUTH_BASE = (process.env.AVAKADO_OAUTH_BASE || "https://app.avakado.ai").replace(/\/+$/, "");
const AUTHORIZE_URL = `${OAUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${OAUTH_BASE}/oauth/token`;
const USERINFO_URL = `${OAUTH_BASE}/oauth/userinfo`;

function formBody(fields) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
        if (value != null && value !== "") body.set(key, String(value));
    }
    return body.toString();
}

function expiresAtFrom(expiresIn) {
    const seconds = Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(Date.now() + seconds * 1000);
}

export default class OauthAvakado extends BaseOAuthProvider {
    name = "avakado";

    getConfig() {
    }

    async getAuthUrl({ state = "", scopes = [], context } = {}) {
        const userId = context.user._id;
        const { clientId, redirectUris } = await OAuthClient.findOne({ clientId: `ava_${userId}` });
        if (!clientId) return this._errorResponse("client_not_found", "OAuth client not found.", 404);
        const params = new URLSearchParams({ response_type: "code" });
        if (clientId) params.set("client_id", clientId);
        if (redirectUris.length > 0) params.set("redirect_uri", redirectUris[0]);
        if (state) params.set("state", state);
        if (scopes.length) params.set("scope", scopes.join(","));
        return { AuthUrl: `${AUTHORIZE_URL}?${params}` };
    }

    async getTokens({ code, client_id, client_secret, redirect_uri } = {}, context) {
        const validation = this._validateStringParam(code, "code");
        if (validation) return validation;
        try {
            const userId = context?.user?._id;
            if (!client_id && userId) client_id = clientIdFromUserId(userId);
            const client = await findActiveClient(client_id);
            if (!client) return this._errorResponse("invalid_client", "Unknown or revoked client", 401);
            if (!redirect_uri) redirect_uri = client.redirectUris?.[0] || null;
            if (!client_secret) return this._errorResponse("invalid_client", "Client secret is required. Pass the secret issued when this OAuth client was created.", 401);
            if (!redirect_uri) return this._errorResponse("invalid_request", "redirect_uri is required", 400);

            const { data } = await axios.post(TOKEN_URL, formBody({ grant_type: "authorization_code", code, redirect_uri, client_id, client_secret }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
            if (!data?.access_token) return this._errorResponse("malformed_response", "Avakado did not return an access token.", 502);
            const credentials = this._credentialsFromToken(data, { client_id, client_secret, redirect_uri });
            const profile = await this.getUserInfo({ accessToken: data.access_token });
            return this._successResponse({ credentials, scope: this._parseScopeString(data.scope, " "), accountDetails: profile.success ? profile.data : null, config: { client_id, client_secret, redirect_uri }, });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async refreshToken({ refreshToken, client_id, client_secret } = {}) {
        const refreshError = this._validateStringParam(refreshToken, "refresh_token");
        if (refreshError) return refreshError;
        try {
            const { data } = await axios.post(TOKEN_URL, formBody({ grant_type: "refresh_token", refresh_token: refreshToken, client_id, client_secret }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
            if (!data?.access_token || !data?.refresh_token) {
                return this._errorResponse("malformed_response", "Avakado did not return a rotated token pair.", 502);
            }
            return this._successResponse(this._credentialsFromToken(data, { client_id, client_secret }));
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getUserInfo({ accessToken } = {}) {
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;
        try {
            const { data } = await axios.get(USERINFO_URL, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!data?.sub && !data?.email) {
                return this._errorResponse("malformed_response", "Avakado userinfo did not include an account.", 502);
            }
            return this._successResponse({
                id: data.sub,
                email: data.email,
                name: data.name,
                business: data.business ? String(data.business) : null,
            });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getTokenInfo({ accessToken } = {}) {
        const profile = await this.getUserInfo({ accessToken });
        if (!profile.success) return profile;
        return this._successResponse({
            clientId: null,
            scopes: [],
            expiresIn: null,
            email: profile.data.email,
            userId: profile.data.id,
            isValid: true,
        });
    }

    async validateToken({ accessToken } = {}) {
        if (!accessToken || typeof accessToken !== "string") return false;
        const profile = await this.getUserInfo({ accessToken });
        return Boolean(profile.success);
    }

    _credentialsFromToken(data, { client_id, client_secret, redirect_uri } = {}) {
        return { accessToken: data.access_token, refreshToken: data.refresh_token || null, tokenType: data.token_type || "Bearer", expiresIn: data.expires_in, expiresAt: expiresAtFrom(data.expires_in), client_id, client_secret, redirect_uri };
    }

    _handleError(error) {
        const response = error?.response;
        if (!response) {
            return this._errorResponse("network_error", "Unable to reach Avakado.", 503);
        }
        const status = response.status || 500;
        const errorData = response.data || {};
        const code = typeof errorData.error === "string" ? errorData.error : "provider_error";
        const message = errorData.error_description || errorData.message || `Avakado error (${status})`;
        return this._errorResponse(code, message, status);
    }
}
