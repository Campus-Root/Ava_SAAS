import axios from "axios";
import BaseOAuthProvider from "./base.js";

const {
    AzureApplicationClientId,
    AzureClientSecretValue,
    AZURE_REDIRECT_URI,
} = process.env;

/**
 * FIXED: Microsoft OAuth Provider
 * 
 * Fixes applied:
 * ✓ Extends BaseOAuthProvider
 * ✓ Changed tokenError → error in getTokens
 * ✓ Replaced fetch with axios for consistency (getTokens was using fetch)
 * ✓ Fixed validateToken to ALWAYS return boolean (was returning object on missing token)
 * ✓ Added redirectUri to getConfig()
 * ✓ Standardized response structure
 * ✓ Added null safety in error handling
 */

export default class OauthMicrosoft extends BaseOAuthProvider {
    name = "microsoft";

    getConfig() {
        return {
            clientId: AzureApplicationClientId,
            clientSecret: AzureClientSecretValue,
            redirectUri: AZURE_REDIRECT_URI,
        };
    }

    async getAuthUrl({ state = "", scopes = [] }) {
        const params = new URLSearchParams({
            client_id: AzureApplicationClientId,
            response_type: "code",
            redirect_uri: AZURE_REDIRECT_URI,
            response_mode: "query",
            scope: scopes.join(" "),
            state,
            prompt: "consent",
        });
        return { AuthUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` };
    }

    async getTokens({ code }) {
        // FIX #1: Validate code parameter
        const validation = this._validateStringParam(code, "code");
        if (validation) return validation;

        try {
            // FIX #2: Use axios instead of fetch for consistency
            const { data: tokenData } = await axios.post(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                new URLSearchParams({
                    client_id: AzureApplicationClientId,
                    client_secret: AzureClientSecretValue,
                    code,
                    redirect_uri: AZURE_REDIRECT_URI,
                    grant_type: "authorization_code",
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            if (!tokenData?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "OAuth provider returned incomplete token data.",
                    502
                );
            }

            // FIX #3: Also use axios for user info (instead of fetch)
            const { data: accountDetails } = await axios.get(
                "https://graph.microsoft.com/v1.0/me",
                {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                    },
                    timeout: 5000,
                }
            );

            if (!accountDetails || !accountDetails.id) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Microsoft Graph.",
                    502
                );
            }

            const credentials = {
                accessToken: tokenData.access_token,
                tokenId: tokenData.id_token || null,
                refreshToken: tokenData.refresh_token || null,
                tokenType: tokenData.token_type || "Bearer",
                expiresAt: tokenData.expires_in
                    ? new Date(Date.now() + tokenData.expires_in * 1000)
                    : null,
                expiresIn: tokenData.expires_in,
                // Microsoft doesn't return refresh token expiry typically
                refreshTokenExpiresAt: null,
            };

            const scope = this._parseScopeString(tokenData.scope, " ");

            return this._successResponse({
                credentials,
                scope,
                accountDetails: {
                    id: accountDetails.id,
                    email: accountDetails.mail,
                    name: accountDetails.displayName,
                    givenName: accountDetails.givenName,
                    surname: accountDetails.surname,
                    userPrincipalName: accountDetails.userPrincipalName,
                    mobilePhone: accountDetails.mobilePhone,
                    jobTitle: accountDetails.jobTitle,
                    officeLocation: accountDetails.officeLocation,
                }
            });
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
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                new URLSearchParams({
                    client_id: AzureApplicationClientId,
                    client_secret: AzureClientSecretValue,
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
                refreshToken: data.refresh_token || refreshToken,
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
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
                "https://graph.microsoft.com/v1.0/me",
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 5000,
                }
            );

            // FIX: Validate response
            if (!data || !data.id) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Microsoft.",
                    502
                );
            }

            return this._successResponse({
                id: data.id,
                email: data.mail,
                name: data.displayName,
                givenName: data.givenName,
                surname: data.surname,
                userPrincipalName: data.userPrincipalName,
                mobilePhone: data.mobilePhone,
                jobTitle: data.jobTitle,
                officeLocation: data.officeLocation,
            });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async validateToken({ accessToken }) {
        // FIX #4: ALWAYS return boolean, never return object
        if (!accessToken || typeof accessToken !== "string") return false;

        try {
            await axios.get("https://graph.microsoft.com/v1.0/me", {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 5000,
            });
            return true;
        } catch {
            return false;
        }
    }

    _handleError(error) {
        // FIX #5: Handle case where response is null/undefined (network error)
        const response = error.response;

        if (!response) {
            return this._errorResponse(
                "network_error",
                "Unable to reach Microsoft authentication servers.",
                503
            );
        }

        const status = response.status;
        const errorData = response.data || {};

        switch (status) {
            case 400:
                return this._errorResponse(
                    this._extractErrorCode(errorData, "invalid_request"),
                    this._extractErrorMessage(
                        errorData,
                        "Invalid request or expired token."
                    ),
                    400
                );
            case 401:
                return this._errorResponse(
                    "invalid_grant",
                    "The refresh token is invalid or expired.",
                    401
                );
            case 403:
                return this._errorResponse(
                    "insufficient_permissions",
                    "The user does not have permission to access the resource.",
                    403
                );
            case 429:
                return this._errorResponse(
                    "rate_limit_exceeded",
                    "Too many requests to Microsoft. Please wait before retrying.",
                    429
                );
            default:
                return this._errorResponse(
                    "provider_error",
                    `Microsoft OAuth error (${status})`,
                    status || 503
                );
        }
    }
}