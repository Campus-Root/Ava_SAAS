import axios from "axios";
import BaseOAuthProvider from "./base.js";

const {
    CALENDLY_CLIENT_ID,
    CALENDLY_CLIENT_SECRET,
    CALENDLY_REDIRECT_URI,
} = process.env;

/**
 * FIXED: Calendly OAuth Provider
 * 
 * Fixes applied:
 * ✓ Extends BaseOAuthProvider
 * ✓ Changed tokenError → error in getTokens for consistency
 * ✓ Fixed refreshToken response to include refreshToken (it was missing!)
 * ✓ Added isSingleUseRefreshToken flag to signal caller to replace token
 * ✓ Added redirectUri to getConfig()
 * ✓ Standardized response structure
 * ✓ Added null safety in error handling
 * 
 * NOTE: Calendly uses OAuth 2.1 single-use refresh token rotation.
 * Every call to refreshToken returns a NEW refresh token.
 * The OLD one becomes INVALID after use.
 * Callers MUST overwrite the stored refresh token immediately.
 */

export default class OauthCalendly extends BaseOAuthProvider {
    name = "calendly";

    getConfig() {
        return {
            clientId: CALENDLY_CLIENT_ID,
            clientSecret: CALENDLY_CLIENT_SECRET,
            redirectUri: CALENDLY_REDIRECT_URI,
        };
    }

    async getAuthUrl({ state = "", scopes = [] }) {
        const params = new URLSearchParams({
            client_id: CALENDLY_CLIENT_ID,
            redirect_uri: CALENDLY_REDIRECT_URI,
            response_type: "code",
            ...(scopes.length > 0 && { scope: scopes.join(" ") }),
            ...(state && { state }),
        });
        return { AuthUrl: `https://auth.calendly.com/oauth/authorize?${params}` };
    }

    async getTokens({ code }) {
        // FIX #1: Validate code parameter
        const validation = this._validateStringParam(code, "code");
        if (validation) return validation;

        try {
            const { data } = await axios.post(
                "https://auth.calendly.com/oauth/token",
                new URLSearchParams({
                    grant_type: "authorization_code",
                    client_id: CALENDLY_CLIENT_ID,
                    client_secret: CALENDLY_CLIENT_SECRET,
                    redirect_uri: CALENDLY_REDIRECT_URI,
                    code,
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            if (!data?.access_token || !data?.refresh_token) {
                return this._errorResponse(
                    "malformed_response",
                    "OAuth provider returned incomplete token data (missing access or refresh token).",
                    502
                );
            }

            const credentials = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
                // FIX #2: Signal that this is a single-use refresh token
                // Caller MUST replace stored refresh_token immediately
                isSingleUseRefreshToken: true,
                refreshTokenExpiresAt: null, // Calendly doesn't expire refresh tokens
            };

            const scope = this._parseScopeString(data.scope, " ");

            // Calendly has no id_token — fetch user info from /users/me
            const userInfoResult = await this.getUserInfo({
                accessToken: data.access_token,
            });
            const accountDetails = userInfoResult.success
                ? userInfoResult.data
                : null;

            return this._successResponse({credentials, scope, accountDetails});
        } catch (error) {
            return this._handleError(error);
        }
    }

    async refreshToken({ refreshToken }) {
        // FIX: Validate refreshToken parameter
        const validation = this._validateStringParam(refreshToken, "refreshToken");
        if (validation) return validation;

        try {
            const { data } = await axios.post(
                "https://auth.calendly.com/oauth/token",
                new URLSearchParams({
                    grant_type: "refresh_token",
                    client_id: CALENDLY_CLIENT_ID,
                    client_secret: CALENDLY_CLIENT_SECRET,
                    refresh_token: refreshToken,
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            if (!data?.access_token || !data?.refresh_token) {
                return this._errorResponse(
                    "malformed_response",
                    "OAuth provider returned incomplete refresh response (missing access or refresh token).",
                    502
                );
            }

            // FIX #3: Include NEW refresh token in response (was missing!)
            // On 400/401 (invalid_grant), the old token was already used/expired.
            // Caller should prompt user to re-authorize.
            const refreshed = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token, // NEW token (single-use)
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
                // Signal caller to REPLACE old token with this new one
                isSingleUseRefreshToken: true,
                refreshTokenExpiresAt: null,
            };

            return this._successResponse({ credentials: refreshed });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getUserInfo({ accessToken }) {
        // FIX: Validate accessToken parameter
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            const { data } = await axios.get(
                "https://api.calendly.com/users/me",
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 5000,
                }
            );

            if (!data?.resource) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Calendly.",
                    502
                );
            }

            const resource = data.resource;
            // Extract UUID from full URI: "https://api.calendly.com/users/AAAA" → "AAAA"
            const id = resource.uri?.split("/").pop() ?? null;

            return this._successResponse({ id, resource });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async validateToken({ accessToken }) {
        // FIX: ALWAYS return boolean
        if (!accessToken || typeof accessToken !== "string") return false;

        try {
            await axios.get("https://api.calendly.com/users/me", {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 5000,
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * OPTIONAL: Revoke a token (access or refresh)
     * This is Calendly-specific but useful for logout flow
     */
    async revokeToken({ token }) {
        // Note: Parameter is 'token' not 'refreshToken' for flexibility
        // Can be either access token or refresh token
        if (!token || typeof token !== "string") {
            return this._errorResponse(
                "missing_token",
                "A token string is required.",
                400
            );
        }

        try {
            await axios.post(
                "https://auth.calendly.com/oauth/revoke",
                new URLSearchParams({
                    client_id: CALENDLY_CLIENT_ID,
                    client_secret: CALENDLY_CLIENT_SECRET,
                    token,
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );
            return { success: true };
        } catch (error) {
            return this._handleError(error);
        }
    }

    _handleError(error) {
        // FIX: Handle case where response is null/undefined (network error)
        const response = error.response;

        if (!response) {
            return this._errorResponse(
                "network_error",
                "Unable to reach Calendly authentication servers.",
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
                    `Calendly OAuth error (${status})`,
                    status || 503
                );
        }
    }
}