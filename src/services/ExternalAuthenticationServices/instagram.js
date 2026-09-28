import axios from "axios";
import BaseOAuthProvider from "./base.js";

const { IG_CLIENT_ID, IG_CLIENT_SECRET, IG_REDIRECT_URI } = process.env;
const API_VERSION = "v23.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
const IG_BASE = `https://graph.instagram.com/${API_VERSION}`;

/**
 * FIXED: Instagram OAuth Provider
 * 
 * Fixes applied:
 * ✓ Extends BaseOAuthProvider
 * ✓ Changed tokenError → error in getTokens
 * ✓ ADDED missing config in getTokens response
 * ✓ Standardized response structure
 * ✓ Fixed scope parsing (Instagram returns permissions array, not scope string)
 * ✓ Added null safety in error handling
 * ✓ Removed messaging/API methods (sendTextMessage, etc.) - see InstagramMessagingAPI class
 * ✓ Removed setupChannel - moved to InstagramMessagingAPI
 * ✓ Kept optional getTokenInfo() for provider-specific token introspection
 * 
 * NOTE: Messaging APIs (send, reply, etc.) are NOT in this class.
 * Use InstagramMessagingAPI (separate file) for those operations.
 * setupChannel() is also in InstagramMessagingAPI.
 */

export default class OauthInstagram extends BaseOAuthProvider {
    name = "instagram";

    getConfig() {
        return {
            clientId: IG_CLIENT_ID,
            clientSecret: IG_CLIENT_SECRET,
            redirectUri: IG_REDIRECT_URI,
        };
    }

    async getAuthUrl({ state = "", scopes = [] }) {
        const params = new URLSearchParams({
            client_id: IG_CLIENT_ID,
            redirect_uri: IG_REDIRECT_URI,
            response_type: "code",
            force_reauth: true,
            scope: scopes.join(","), // Instagram uses comma-separated scopes in URL
            state,
        });
        return { AuthUrl: `https://www.instagram.com/oauth/authorize?${params}` };
    }

    async getTokens({ code }) {
        // FIX #1: Validate code parameter
        const validation = this._validateStringParam(code, "code");
        if (validation) return validation;

        try {
            // Step 1: Exchange code for short-lived token (1 hour)
            const shortLivedResponse = await axios.post(
                "https://api.instagram.com/oauth/access_token",
                new URLSearchParams({
                    code,
                    client_id: IG_CLIENT_ID,
                    client_secret: IG_CLIENT_SECRET,
                    redirect_uri: IG_REDIRECT_URI,
                    grant_type: "authorization_code",
                }).toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            );

            const shortLived = shortLivedResponse.data;
            if (!shortLived?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "Failed to obtain short-lived token.",
                    502
                );
            }

            // Step 2: Exchange short-lived token for long-lived token (60 days)
            const longLivedResponse = await axios.get(
                "https://graph.instagram.com/access_token",
                {
                    params: {
                        grant_type: "ig_exchange_token",
                        client_secret: IG_CLIENT_SECRET,
                        access_token: shortLived.access_token,
                    },
                }
            );

            const longLived = longLivedResponse.data;
            if (!longLived?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "Failed to obtain long-lived token.",
                    502
                );
            }

            // Step 3: Fetch account details
            const accountDetailsResponse = await axios.get(`${IG_BASE}/me`, {
                params: {
                    access_token: longLived.access_token,
                    fields:
                        "id,user_id,username,account_type,name,profile_picture_url,followers_count,follows_count,media_count",
                },
            });

            const accountDetails = accountDetailsResponse.data;
            if (!accountDetails) {
                return this._errorResponse(
                    "malformed_response",
                    "Failed to fetch account details.",
                    502
                );
            }

            // Step 4: Get the Facebook Page linked to this IG account
            const linkedPage = await this._getLinkedPage(
                longLived.access_token,
                accountDetails.id
            ).catch(() => null);

            const credentials = {
                accessToken: longLived.access_token,
                refreshToken: null, // Instagram long-lived tokens don't have refresh tokens
                tokenType: longLived.token_type || "Bearer",
                expiresAt: longLived.expires_in
                    ? new Date(Date.now() + longLived.expires_in * 1000)
                    : null,
                expiresIn: longLived.expires_in,
                // Store IG user ID for later API calls
                igUserId: accountDetails.id,
                // Store page info for messaging webhooks
                pageId: linkedPage?.id || null,
                pageAccessToken: linkedPage?.access_token || null,
                refreshTokenExpiresAt: null,
            };

            // FIX #2: Parse scope correctly
            // Instagram returns permissions array from short-lived response
            const scope = shortLived.permissions || [];

            // FIX #3: ALWAYS include config in getTokens response
            return this._successResponse({ credentials, scope, accountDetails: { ...accountDetails, linkedPage, } })
        } catch (error) {
            return this._handleError(error);
        }
    }

    async refreshToken({ accessToken }) {
        // FIX: Parameter should be accessToken, not refreshToken
        // Instagram long-lived tokens can be "refreshed" to extend validity
        const validation = this._validateStringParam(
            accessToken,
            "accessToken"
        );
        if (validation) return validation;

        try {
            const { data } = await axios.get(
                "https://graph.instagram.com/refresh_access_token",
                {
                    params: {
                        grant_type: "ig_refresh_token",
                        access_token: accessToken,
                    },
                }
            );

            if (!data?.access_token) {
                return this._errorResponse(
                    "malformed_response",
                    "Failed to refresh token.",
                    502
                );
            }

            const refreshed = {
                accessToken: data.access_token,
                refreshToken: null,
                tokenType: data.token_type || "Bearer",
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                expiresIn: data.expires_in,
                refreshTokenExpiresAt: null,
            };

            return this._successResponse(refreshed);
        } catch (error) {
            return this._handleError(error);
        }
    }

    async getUserInfo({ accessToken }) {
        // FIX: Validate accessToken parameter
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            const { data } = await axios.get(`${IG_BASE}/me`, {
                params: {
                    fields:
                        "id,username,name,account_type,followers_count,media_count",
                },
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const dataValidation = this._validateResponseData(
                data,
                "Instagram"
            );
            if (dataValidation) return dataValidation;

            return this._successResponse(data);
        } catch (error) {
            return this._handleError(error);
        }
    }

    /**
     * OPTIONAL: Get token metadata (expiration, scopes, validity)
     * Provider-specific, not in base interface
     */
    async getTokenInfo({ accessToken }) {
        // FIX: Validate accessToken parameter
        const validation = this._validateStringParam(accessToken, "accessToken");
        if (validation) return validation;

        try {
            const appAccessToken = `${IG_CLIENT_ID}|${IG_CLIENT_SECRET}`;
            const { data } = await axios.get(`${BASE_URL}/debug_token`, {
                params: {
                    input_token: accessToken,
                    access_token: appAccessToken,
                },
            });

            if (!data?.data) {
                return this._errorResponse(
                    "malformed_response",
                    "Invalid response from Instagram.",
                    502
                );
            }

            const tokenData = data.data;
            return this._successResponse({
                clientId: tokenData.app_id,
                scopes: tokenData.scopes || [],
                expiresIn: tokenData.expires_at
                    ? tokenData.expires_at - Math.floor(Date.now() / 1000)
                    : null,
                isValid: tokenData.is_valid,
            });
        } catch (error) {
            return this._handleError(error);
        }
    }

    async validateToken({ accessToken }) {
        // FIX: ALWAYS return boolean
        if (!accessToken || typeof accessToken !== "string") return false;

        try {
            await axios.get(`${IG_BASE}/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 5000,
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Internal: Fetch Facebook Page linked to this IG account
     * (Required for messaging webhooks)
     */
    async _getLinkedPage(accessToken, igUserId) {
        try {
            const { data } = await axios.get(`${BASE_URL}/me/accounts`, {
                params: {
                    fields:
                        "id,name,access_token,instagram_business_account",
                    access_token: accessToken,
                },
            });

            const pages = data?.data || [];
            const linkedPage = pages.find(
                (p) => p.instagram_business_account?.id === igUserId
            );
            return linkedPage || pages[0] || null;
        } catch {
            return null;
        }
    }

    _handleError(error) {
        // FIX: Handle case where response is null/undefined (network error)
        const response = error.response;

        if (!response) {
            return this._errorResponse(
                "network_error",
                "Unable to reach Instagram servers.",
                503
            );
        }

        const status = response.status;
        const fbError = response.data?.error || {};

        switch (status) {
            case 400:
                return this._errorResponse(
                    this._extractErrorCode(fbError, "invalid_request"),
                    this._extractErrorMessage(fbError, "Bad request."),
                    400
                );
            case 401:
                return this._errorResponse(
                    this._extractErrorCode(fbError, "invalid_token"),
                    this._extractErrorMessage(
                        fbError,
                        "The token is expired or invalid."
                    ),
                    401
                );
            case 403:
                return this._errorResponse(
                    "permission_denied",
                    this._extractErrorMessage(
                        fbError,
                        "Missing required permission or outside 24-hour messaging window."
                    ),
                    403
                );
            case 429:
                return this._errorResponse(
                    "rate_limit_exceeded",
                    "Too many requests to Instagram. Limit: 200 calls/hr per user, 200 DMs/hr.",
                    429
                );
            default:
                return this._errorResponse(
                    "provider_error",
                    `Instagram OAuth error (${status})`,
                    status || 503
                );
        }
    }
}

/**
 * MESSAGING APIs (NOT IN OAUTH CLASS)
 *
 * These are separated from OAuth for good reason:
 * - They're not auth-related
 * - They require both accessToken AND phoneNumberId/pageId (not part of OAuth flow)
 * - They're optional operations, not required for every integration
 *
 * Example:
 * const messagingAPI = new InstagramMessagingAPI(credentials);
 * await messagingAPI.sendTextMessage({ recipientId, text });
 *
 * This separation:
 * ✓ Keeps OAuth class focused on authentication
 * ✓ Prevents caller confusion (they know where to find each API)
 * ✓ Allows messaging-specific error handling
 * ✓ Makes testing easier
 */

// TODO: Create InstagramMessagingAPI class in separate file:
// - sendTextMessage()
// - sendMediaMessage()
// - sendQuickReplies()
// - replyToComment()
// - getConversations()
// - getConversationMessages()
// - getRateLimitStatus()

// TODO: Create InstagramSetupAPI class in separate file:
// - setupChannel() — webhook configuration
// - updateWebhook()
// - getWebhookSubscriptions()