/**
 * ABSTRACT BASE CLASS: OAuthProvider
 * 
 * All OAuth providers (Google, Microsoft, Calendly, Instagram, WhatsApp) must extend this
 * and implement the core methods with STANDARDIZED signatures and response formats.
 * 
 * This ensures:
 * ✓ Consistent error handling across all providers
 * ✓ Predictable response structure for callers
 * ✓ Type safety (no return type surprises)
 */

export class BaseOAuthProvider {
    // ABSTRACT PROPERTIES (override in subclass)
    name = ""; // e.g., "google", "calendly", etc.

    /**
     * [ABSTRACT] Return config object
     * @returns {{clientId: string, clientSecret: string, redirectUri: string}}
     */
    getConfig() {
        throw new Error(`${this.name}.getConfig() not implemented`);
    }

    /**
     * [ABSTRACT] Generate authorization URL
     * @param {object} params
     * @param {string} params.state - CSRF token
     * @param {string[]} params.scopes - OAuth scopes to request
     * @returns {string} - Full authorization URL
     */
    async getAuthUrl({ state = "", scopes = [] }) {
        throw new Error(`${this.name}.getAuthUrl() not implemented`);
    }

    /**
     * [ABSTRACT] Exchange authorization code for access token
     * STANDARDIZED RESPONSE:
     * {
     *   success: true,
     *   data: {
     *     accessToken: string,
     *     refreshToken: string | null,
     *     tokenType: "Bearer",
     *     expiresAt: Date | null,
     *     expiresIn: number,
     *     ...providerSpecificFields
     *   },
     *   scope: string[],
     *   accountDetails: { id, email, name, ...providerSpecificFields },
     *   config: { clientId, clientSecret, redirectUri }
     * }
     *
     * OR on error:
     * {
     *   success: false,
     *   error: { code: string, message: string, status: number }
     * }
     */
    async getTokens() {
        throw new Error(`${this.name}.getTokens() not implemented`);
    }

    /**
     * [ABSTRACT] Refresh an expired access token
     * STANDARDIZED RESPONSE:
     * {
     *   success: true,
     *   data: {
     *     accessToken: string,
     *     refreshToken: string | null,
     *     tokenType: "Bearer",
     *     expiresAt: Date | null,
     *     expiresIn: number,
     *     ...providerSpecificFields
     *   }
     * }
     *
     * OR on error:
     * {
     *   success: false,
     *   error: { code: string, message: string, status: number }
     * }
     */
    async refreshToken({ refreshToken }) {
        throw new Error(`${this.name}.refreshToken() not implemented`);
    }

    /**
     * [ABSTRACT] Fetch authenticated user's profile
     * STANDARDIZED RESPONSE:
     * {
     *   success: true,
     *   data: {
     *     id: string,
     *     email: string,
     *     name: string,
     *     ...providerSpecificFields
     *   }
     * }
     *
     * OR on error:
     * {
     *   success: false,
     *   error: { code: string, message: string, status: number }
     * }
     */
    async getUserInfo({ accessToken }) {
        throw new Error(`${this.name}.getUserInfo() not implemented`);
    }

    /**
     * [ABSTRACT] Validate if access token is still valid
     * @param {object} params
     * @param {string} params.accessToken - Token to validate
     * @returns {boolean} - ALWAYS returns boolean (not object)
     */
    async validateToken({ accessToken }) {
        throw new Error(`${this.name}.validateToken() not implemented`);
    }

    /**
     * [REQUIRED] Standardized error handler
     * All providers must implement this with consistent return format.
     * 
     * @param {Error} error - axios/fetch error object
     * @returns {{code: string, message: string, status: number}}
     * @protected
     */
    _handleError(error) {
        throw new Error(`${this.name}._handleError() not implemented`);
    }

    // ============================================================
    // COMMON VALIDATION HELPERS (use in all providers)
    // ============================================================

    /**
     * Validate parameter is non-empty string
     * @param {any} value - Value to check
     * @param {string} paramName - Parameter name for error message
     * @returns {object|null} - Returns error response if invalid, null if valid
     * @protected
     */
    _validateStringParam(value, paramName) {
        if (!value || typeof value !== "string") {
            return {
                success: false,
                error: {
                    code: `missing_${paramName}`,
                    message: `A ${paramName} string is required.`,
                    status: 400,
                },
            };
        }
        return null;
    }

    /**
     * Validate response has required data
     * @param {any} data - Response data to check
     * @param {string} context - Context for error message
     * @returns {object|null} - Returns error response if invalid, null if valid
     * @protected
     */
    _validateResponseData(data, context = "provider") {
        if (!data || Object.keys(data).length === 0) {
            return {
                success: false,
                error: {
                    code: "malformed_response",
                    message: `Invalid or empty response from ${context}.`,
                    status: 502,
                },
            };
        }
        return null;
    }

    /**
     * Parse scope string to array
     * Handles both space-separated (Google, Microsoft) and comma-separated (Meta)
     * @param {string} scopeString - Raw scope string
     * @param {string} separator - Space or comma
     * @returns {string[]} - Array of scopes
     * @protected
     */
    _parseScopeString(scopeString, separator = " ") {
        if (!scopeString) return [];
        return scopeString
            .split(separator)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }

    /**
     * Build standardized error response
     * All providers should use this for consistent error format
     * @param {number} status - HTTP status code
     * @param {string} code - Error code
     * @param {string} message - Error message
     * @returns {{code: string, message: string, status: number}}
     * @protected
     */
    _buildErrorResponse(status, code, message) {
        return {
            code,
            message,
            status,
        };
    }

    /**
     * Extract error code from OAuth provider response
     * Tries multiple common error field names
     * @param {object} responseData - OAuth provider error response
     * @param {string} defaultCode - Fallback error code
     * @returns {string}
     * @protected
     */
    _extractErrorCode(responseData, defaultCode = "provider_error") {
        return (
            responseData?.error ||
            responseData?.error_code ||
            responseData?.code ||
            responseData?.type ||
            defaultCode
        );
    }

    /**
     * Extract error message from OAuth provider response
     * Tries multiple common message field names
     * @param {object} responseData - OAuth provider error response
     * @param {string} defaultMessage - Fallback message
     * @returns {string}
     * @protected
     */
    _extractErrorMessage(responseData, defaultMessage = "An error occurred") {
        return (
            responseData?.message ||
            responseData?.error_description ||
            responseData?.error ||
            responseData?.msg ||
            defaultMessage
        );
    }

    /**
     * Standardized response wrapper
     * Use when you have valid data to return
     * @param {object} data - Response data
     * @param {string[]} scope - Array of granted scopes (optional)
     * @param {object} accountDetails - User details (optional)
     * @param {object} config - OAuth config (optional, only for getTokens)
     * @returns {object} - Standardized response
     * @protected
     */
    _successResponse(data) {
        const response = { success: true, data };
        return response;
    }

    /**
     * Standardized error response wrapper
     * @param {string} code - Error code
     * @param {string} message - Error message
     * @param {number} status - HTTP status code
     * @returns {object} - Standardized error response
     * @protected
     */
    _errorResponse(code, message, status = 500) {
        return {
            success: false,
            error: { code, message, status },
        };
    }
}

export default BaseOAuthProvider;




// name
// getConfig
//getAuthUrl
//getTokens
//refreshToken
//getUserInfo
//validateToken
//_handleError

// /**
//  * [ABSTRACT] Exchange authorization code for access token
//  * STANDARDIZED RESPONSE:
//  * {
//  *   success: true,
//  *   data: {
//  *     accessToken: string,
//  *     refreshToken: string | null,
//  *     tokenType: "Bearer",
//  *     expiresAt: Date | null,
//  *     expiresIn: number,
//  *     ...providerSpecificFields
//  *   },
//  *   scope: string[],
//  *   accountDetails: { id, email, name, ...providerSpecificFields },
//  *   config: { clientId, clientSecret, redirectUri }
//  * }
//  *
//  * OR on error:
//  * {
//  *   success: false,
//  *   error: { code: string, message: string, status: number }
//  * }
//  */
// async getTokens() {
//     throw new Error(`${this.name}.getTokens() not implemented`);
// }

// /**
//  * [ABSTRACT] Refresh an expired access token
//  * STANDARDIZED RESPONSE:
//  * {
//  *   success: true,
//  *   data: {
//  *     accessToken: string,
//  *     refreshToken: string | null,
//  *     tokenType: "Bearer",
//  *     expiresAt: Date | null,
//  *     expiresIn: number,
//  *     ...providerSpecificFields
//  *   }
//  * }
//  *
//  * OR on error:
//  * {
//  *   success: false,
//  *   error: { code: string, message: string, status: number }
//  * }
//  */
// async refreshToken({ refreshToken }) {
//     throw new Error(`${this.name}.refreshToken() not implemented`);
// }

// /**
//  * [ABSTRACT] Fetch authenticated user's profile
//  * STANDARDIZED RESPONSE:
//  * {
//  *   success: true,
//  *   data: {
//  *     id: string,
//  *     email: string,
//  *     name: string,
//  *     ...providerSpecificFields
//  *   }
//  * }
//  *
//  * OR on error:
//  * {
//  *   success: false,
//  *   error: { code: string, message: string, status: number }
//  * }
//  */
// async getUserInfo({ accessToken }) {
//     throw new Error(`${this.name}.getUserInfo() not implemented`);
// }

// /**
//  * [ABSTRACT] Validate if access token is still valid
//  * @param {object} params
//  * @param {string} params.accessToken - Token to validate
//  * @returns {boolean} - ALWAYS returns boolean (not object)
//  */
// async validateToken({ accessToken }) {
//     throw new Error(`${this.name}.validateToken() not implemented`);
// }

// /**
//  * [REQUIRED] Standardized error handler
//  * All providers must implement this with consistent return format.
//  * 
//  * @param {Error} error - axios/fetch error object
//  * @returns {{code: string, message: string, status: number}}
//  * @protected
//  */
// _handleError(error) {
//     throw new Error(`${this.name}._handleError() not implemented`);
// }