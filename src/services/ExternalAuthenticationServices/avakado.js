import axios from "axios";
import BaseOAuthProvider from "./base.js";

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
        return {
            clientId: process.env.AVAKADO_OAUTH_CLIENT_ID || "",
            clientSecret: process.env.AVAKADO_OAUTH_CLIENT_SECRET || "",
            redirectUri: process.env.AVAKADO_OAUTH_REDIRECT_URI || "",
        };
    }

    getAuthUrl({ state = "", scopes = [], clientId, redirectUri, codeChallenge, codeChallengeMethod = "S256" } = {}) {
        const config = this.getConfig();
        const id = clientId || config.clientId;
        const redirect = redirectUri || config.redirectUri;
        const params = new URLSearchParams({ response_type: "code" });
        if (id) params.set("client_id", id);
        if (redirect) params.set("redirect_uri", redirect);
        if (state) params.set("state", state);
        if (scopes.length) params.set("scope", scopes.join(" "));
        if (codeChallenge) {
            params.set("code_challenge", codeChallenge);
            params.set("code_challenge_method", codeChallengeMethod || "S256");
        }
        return {
            AuthUrl: `${AUTHORIZE_URL}?${params}`,
            ExpectedKeysFromQuery: {
                type: "object",
                required: ["clientId", "clientSecret", "redirectUri", "code"],
                properties: {
                    clientId: {
                        type: "string",
                        description: "OAuth client id from the Ava dashboard",
                        minLength: 1,
                        xUi: {
                            label: "Client ID",
                            inputType: "text",
                            placeholder: "ava_<userId>",
                            helpText: "Created in the dashboard. One client per user.",
                        },
                    },
                    clientSecret: {
                        type: "string",
                        description: "OAuth client secret",
                        minLength: 1,
                        xUi: {
                            label: "Client secret",
                            inputType: "password",
                            sensitive: true,
                            placeholder: "ava_sk_…",
                            helpText: "Shown once when the client is created or the secret is rotated.",
                        },
                    },
                    redirectUri: {
                        type: "string",
                        description: "Redirect URI registered on the client",
                        minLength: 1,
                        xUi: {
                            label: "Redirect URI",
                            inputType: "text",
                            helpText: "Must match a registered redirect URI exactly, including the path.",
                        },
                    },
                    code: {
                        type: "string",
                        description: "Authorization code from the redirect",
                        minLength: 1,
                        xUi: {
                            label: "Authorization code",
                            inputType: "text",
                            helpText: "Single use. Expires two minutes after the user approves.",
                        },
                    },
                    codeVerifier: {
                        type: "string",
                        description: "PKCE verifier when authorize sent a code_challenge",
                        xUi: {
                            label: "PKCE verifier",
                            inputType: "text",
                            helpText: "Required only when the authorize request included code_challenge.",
                        },
                    },
                },
                additionalProperties: false,
            },
        };
    }

    async getTokens({ code, clientId, clientSecret, redirectUri, redirect_uri, codeVerifier, code_verifier } = {}) {
        const id = clientId || this.getConfig().clientId;
        const secret = clientSecret || this.getConfig().clientSecret;
        const redirect = redirectUri || redirect_uri || this.getConfig().redirectUri;
        const verifier = codeVerifier || code_verifier;
        for (const [name, value] of [["code", code], ["clientId", id], ["clientSecret", secret], ["redirectUri", redirect]]) {
            const invalid = this._validateStringParam(value, name);
            if (invalid) return invalid;
        }
        try {
            const { data } = await axios.post(TOKEN_URL, formBody({
                grant_type: "authorization_code",
                code,
                redirect_uri: redirect,
                client_id: id,
                client_secret: secret,
                code_verifier: verifier,
            }), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            if (!data?.access_token) {
                return this._errorResponse("malformed_response", "Avakado did not return an access token.", 502);
            }
            const credentials = this._credentialsFromToken(data, { clientId: id, clientSecret: secret, redirectUri: redirect });
            const profile = await this.getUserInfo({ accessToken: data.access_token });
            return this._successResponse({
                credentials,
                scope: this._parseScopeString(data.scope, " "),
                accountDetails: profile.success ? profile.data : null,
                config: { clientId: id, redirectUri: redirect },
            });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async refreshToken({ refreshToken, clientId, clientSecret } = {}) {
        const id = clientId || this.getConfig().clientId;
        const secret = clientSecret || this.getConfig().clientSecret;
        const refreshError = this._validateStringParam(refreshToken, "refreshToken");
        if (refreshError) return refreshError;
        const idError = this._validateStringParam(id, "clientId");
        if (idError) return idError;
        const secretError = this._validateStringParam(secret, "clientSecret");
        if (secretError) return secretError;
        try {
            const { data } = await axios.post(TOKEN_URL, formBody({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: id,
                client_secret: secret,
            }), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            if (!data?.access_token || !data?.refresh_token) {
                return this._errorResponse("malformed_response", "Avakado did not return a rotated token pair.", 502);
            }
            return this._successResponse(this._credentialsFromToken(data, { clientId: id, clientSecret: secret }));
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

    _credentialsFromToken(data, { clientId, clientSecret, redirectUri } = {}) {
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || null,
            tokenType: data.token_type || "Bearer",
            expiresIn: data.expires_in,
            expiresAt: expiresAtFrom(data.expires_in),
            clientId: clientId || null,
            clientSecret: clientSecret || null,
            redirectUri: redirectUri || null,
        };
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
