import axios from "axios";
import jwt from "jsonwebtoken";
import BaseOAuthProvider from "./base.js";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

/**
 * FIXED: Google OAuth Provider
 * 
 * Fixes applied:
 * ✓ Extends BaseOAuthProvider
 * ✓ Changed tokenError → error in getTokens
 * ✓ Fixed validateToken to ALWAYS return boolean (was returning object on missing token)
 * ✓ Standardized response structure
 * ✓ Added null safety in error handling
 * ✓ Uses helper methods from base class
 */

export default class OauthGoogle extends BaseOAuthProvider {
    name = "google";

    getConfig() {
        return {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            redirectUri: GOOGLE_REDIRECT_URI,
        };
    }

    async getAuthUrl({ state = "", scopes = [] }) {
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: GOOGLE_REDIRECT_URI,
            response_type: "code",
            scope: scopes.join(" "),
            access_type: "offline",
            prompt: "consent",
            state,
        });
        return { AuthUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
    }

    async getTokens({ code }) {
        // FIX #1: Validate code parameter
        const validation = this._validateStringParam(code, "code");
        if (validation) return validation;

        try {
            const { data } = await axios.post(
                "https://oauth2.googleapis.com/token",
                new URLSearchParams({
                    code,
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: GOOGLE_REDIRECT_URI,
                    grant_type: "authorization_code",
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            // FIX #2: Validate response has required fields
            if (!data?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "OAuth provider returned incomplete token data.",
                    502
                );
            }

            const credentials = {
                accessToken: data.access_token,
                // FIX: Google includes id_token (JWT) with user info
                tokenId: data.id_token || null,
                refreshToken: data.refresh_token || null,
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
                // Refresh tokens expire much later, but usually very long-lived
                refreshTokenExpiresAt: data.refresh_token_expires_in
                    ? new Date(Date.now() + data.refresh_token_expires_in * 1000)
                    : null,
            };

            const scope = this._parseScopeString(data.scope, " ");

            // Decode id_token to get user info (no extra API call needed)
            const decoded = jwt.decode(data.id_token);
            const accountDetails = decoded
                ? {
                    id: decoded.sub,
                    email: decoded.email,
                    name: decoded.name,
                    given_name: decoded.given_name,
                    family_name: decoded.family_name,
                    picture: decoded.picture,
                    email_verified: decoded.email_verified,
                    locale: decoded.locale,
                }
                : null;

            return this._successResponse({ credentials, scope, accountDetails });
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
                "https://oauth2.googleapis.com/token",
                new URLSearchParams({
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    refresh_token: refreshToken,
                    grant_type: "refresh_token",
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            if (!data?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "OAuth provider returned incomplete refresh response.",
                    502
                );
            }

            const refreshed = {
                accessToken: data.access_token,
                tokenId: data.id_token || null,
                refreshToken: data.refresh_token || refreshToken, // Use new if provided, else use old
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
                refreshTokenExpiresAt: null, // Not provided on refresh
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
                "https://www.googleapis.com/oauth2/v1/userinfo",
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 5000,
                }
            );

            if (!data?.id) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Google.",
                    502
                );
            }

            return this._successResponse({
                id: data.id,
                email: data.email,
                name: data.name,
                given_name: data.given_name,
                family_name: data.family_name,
                picture: data.picture,
                email_verified: data.verified_email,
                locale: data.locale,
            });
        } catch (error) {
            return this._handleError(error);
        }
    }

    /**
     * Optional: Get token metadata (expiration, scopes, etc.)
     * Not in base class, provider-specific
     */
    async getTokenInfo({ accessToken }) {
        // FIX: Validate accessToken parameter
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            const { data } = await axios.get(
                "https://oauth2.googleapis.com/tokeninfo",
                {
                    params: { access_token: accessToken },
                    timeout: 5000,
                }
            );

            if (!data) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Google.",
                    502
                );
            }

            return this._successResponse({
                clientId: data.azp,
                scopes: this._parseScopeString(data.scope, " "),
                expiresIn: parseInt(data.expires_in) || 0,
                email: data.email,
                isValid: true,
            });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async validateToken({ accessToken }) {
        // FIX #3: ALWAYS return boolean, never return object
        if (!accessToken || typeof accessToken !== "string") return false;

        try {
            await axios.get("https://oauth2.googleapis.com/tokeninfo", {
                params: { access_token: accessToken },
                timeout: 5000,
            });
            return true;
        } catch {
            return false;
        }
    }

    _handleError(error) {
        // FIX #4: Handle case where response is null/undefined (network error)
        const response = error.response;

        if (!response) {
            return this._errorResponse(
                "network_error",
                "Unable to reach Google authentication servers.",
                503
            );
        }

        const status = response.status;
        const errorData = response.data || {};

        switch (status) {
            case 400:
                return this._errorResponse(
                    this._extractErrorCode(errorData, "invalid_request"),
                    this._extractErrorMessage(errorData, "Invalid request or expired token."),
                    400
                );
            case 401:
                return this._errorResponse(
                    "invalid_token",
                    "The token is expired or invalid.",
                    401
                );
            case 403:
                return this._errorResponse(
                    "forbidden",
                    "Insufficient permissions.",
                    403
                );
            case 429:
                return this._errorResponse(
                    "rate_limit_exceeded",
                    "Too many requests to Google. Please wait before retrying.",
                    429
                );
            default:
                return this._errorResponse(
                    "provider_error",
                    `Google OAuth error (${status})`,
                    status || 503
                );
        }
    }
}