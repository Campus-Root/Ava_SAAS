import AuthService from "../services/authService.js";
import { REFRESH_COOKIE_NAME, sendRenewedAccessToken } from "../utils/authCookies.js";

export async function authenticateBearer(req, res, token) {
    const { success, message, data } = await AuthService.verifyTokens(token);
    if (success) {
        const { data: user } = await AuthService.verifyDecodedToken(data.decoded);
        return { user, accessToken: token };
    }
    if (message === "jwt expired") {
        const renewed = await AuthService.renewExpiredDashboardAccess(token, req.cookies?.[REFRESH_COOKIE_NAME]);
        if (renewed) {
            sendRenewedAccessToken(res, renewed);
            const { data: user } = await AuthService.verifyDecodedToken({ id: renewed.decoded.id });
            return { user, accessToken: renewed.accessToken };
        }
    }
    return { error: message || "Token Verification Failed" };
}

export const authMiddleware = async (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false, message: 'Access Token Missing', data: null });
    const token = req.headers.authorization.split(" ")[1];
    if (!token || token.trim() === "" || token === 'null' || token === 'undefined') return res.status(401).json({ success: false, message: 'Access Token Missing', data: null });

    const session = await authenticateBearer(req, res, token);
    if (session.error) return res.status(401).json({ success: false, message: session.error, data: null });
    req.user = session.user;
    return next();
}

export const conditionalAuth = (conditionFn, middleware) => {
    return (req, res, next) => {
        if (conditionFn(req)) {
            return middleware(req, res, next);
        }
        next();
    };
};

// Role-based authorization middleware
export const isAdmin = (req, res, next) => {
    if (req.user.role === "admin") return next();
    return res.status(401).json({ success: false, message: 'Unauthorized entry', data: null });
}

export const isSuperAdmin = (req, res, next) => {
    if (req.user.role === "superAdmin") return next();
    return res.status(401).json({ success: false, message: 'Unauthorized entry', data: null });
}

export const isManager = (req, res, next) => {
    if (req.user.role === "manager") return next();
    return res.status(401).json({ success: false, message: 'Unauthorized entry', data: null });
}

// Scope-based authorization middleware
export const requireScope = (requiredScope) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        }

        if (req.user.hasScope(requiredScope)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: `Insufficient permissions. Required scope: ${requiredScope}`,
            data: null
        });
    };
};

export const requireAnyScope = (requiredScopes) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        }

        if (req.user.hasAnyScope(requiredScopes)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: `Insufficient permissions. Required one of: ${requiredScopes.join(', ')}`,
            data: null
        });
    };
};

export const requireAllScopes = (requiredScopes) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        }

        if (req.user.hasAllScopes(requiredScopes)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: `Insufficient permissions. Required all: ${requiredScopes.join(', ')}`,
            data: null
        });
    };
};

// Business-specific authorization middleware
export const requireBusinessAccess = (businessIdField = 'business') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        }

        // Super admins can access all businesses
        if (req.user.role === 'superAdmin') {
            return next();
        }

        // Get business ID from request (could be in params, body, or query)
        const businessId = req.params[businessIdField] || req.body[businessIdField] || req.query[businessIdField];

        if (!businessId) {
            return res.status(400).json({ success: false, message: 'Business ID required', data: null });
        }

        // Check if user belongs to the business
        if (req.user.business && req.user.business.toString() === businessId.toString()) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: 'Access denied to this business',
            data: null
        });
    };
};

// Combined scope and business access middleware
export const requireBusinessScope = (requiredScope, businessIdField = 'business') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        }

        // Check scope first
        if (!req.user.hasScope(requiredScope)) {
            return res.status(403).json({
                success: false,
                message: `Insufficient permissions. Required scope: ${requiredScope}`,
                data: null
            });
        }

        // Super admins can access all businesses
        if (req.user.role === 'superAdmin') {
            return next();
        }

        // Get business ID from request
        const businessId = req.params[businessIdField] || req.body[businessIdField] || req.query[businessIdField];

        if (!businessId) {
            return res.status(400).json({ success: false, message: 'Business ID required', data: null });
        }

        // Check if user belongs to the business
        if (req.user.business && req.user.business.toString() === businessId.toString()) {
            return next();
        }

        return res.status(403).json({
            success: false,
            message: 'Access denied to this business',
            data: null
        });
    };
};

// Resource ownership middleware
export const requireResourceOwnership = (resourceModel, resourceIdField = 'id', ownerField = 'createdBy') => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        }

        // Super admins can access all resources
        if (req.user.role === 'superAdmin') {
            return next();
        }

        const resourceId = req.params[resourceIdField] || req.body[resourceIdField] || req.query[resourceIdField];

        if (!resourceId) {
            return res.status(400).json({ success: false, message: 'Resource ID required', data: null });
        }

        try {
            const resource = await resourceModel.findById(resourceId);

            if (!resource) {
                return res.status(404).json({ success: false, message: 'Resource not found', data: null });
            }

            // Check if user owns the resource or belongs to the same business
            if (resource[ownerField] && resource[ownerField].toString() === req.user._id.toString()) {
                return next();
            }

            // Check business access if resource has business field
            if (resource.business && req.user.business &&
                resource.business.toString() === req.user.business.toString()) {
                return next();
            }

            return res.status(403).json({
                success: false,
                message: 'Access denied to this resource',
                data: null
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error', data: null });
        }
    };
};

// Rate limiting middleware for scope-based actions
export const scopeRateLimit = (scope, maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    const requests = new Map();
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required', data: null });
        if (!req.user.hasScope(scope)) return res.status(403).json({ success: false, message: `Insufficient permissions. Required scope: ${scope}`, data: null });
        const key = `${req.user._id}:${scope}`;
        const now = Date.now();
        const windowStart = now - windowMs;
        if (!requests.has(key)) requests.set(key, []);
        const userRequests = requests.get(key);
        // Remove old requests outside the window
        const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
        if (validRequests.length >= maxRequests) return res.status(429).json({ success: false, message: 'Rate limit exceeded for this scope', data: null });
        validRequests.push(now);
        requests.set(key, validRequests);
        next();
    };
};

export const authForGraphQL = async (req, res) => {
    try {
        const query = req.body?.query;
        let isIntrospectionQuery = false;
        if (typeof query === "string") {
            // Normal case: query is a string
            isIntrospectionQuery = query.includes("IntrospectionQuery") || query.includes("__schema");
        } else if (Array.isArray(req.body)) {
            // Batched queries
            isIntrospectionQuery = req.body.some((q) => typeof q.query === "string" && (q.query.includes("IntrospectionQuery") || q.query.includes("__schema")));
        }
        if (isIntrospectionQuery) {
            console.log("Allowing introspection query without auth");
            return { user: null, isAuthenticated: false, isIntrospection: true };
        }
        const authHeader = req.headers.authorization;
        if (!authHeader) throw new Error('Access Token Missing');
        const token = authHeader.split(" ")[1];
        if (!token || token.trim() === "" || token === 'null' || token === 'undefined') throw new Error('Access Token Missing');
        const session = await authenticateBearer(req, res, token);
        if (session.error) throw new Error(`Token Verification Failed: ${session.error}`);
        return { req, res, user: session.user, isAuthenticated: true, accessToken: session.accessToken };
    } catch (error) {
        console.error("GraphQL auth failed:", error.message);
        throw new Error('Internal Server Error');
    }
};