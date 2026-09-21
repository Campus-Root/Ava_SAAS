import { ScopesEnum, RoleScopes } from '@avakado.ai/schemas';

/**
 * Scope Management Utility
 * Provides helper functions for managing and validating user scopes
 */

// Get all available scopes
export const getAllScopes = () => {
    return Object.keys(ScopesEnum);
};

// Get scope description
export const getScopeDescription = (scope) => {
    return ScopesEnum[scope] || 'Unknown scope';
};

// Get scopes by category
export const getScopesByCategory = () => {
    const categories = {};

    Object.entries(ScopesEnum).forEach(([scope, description]) => {
        const category = scope.split(':')[0];
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category].push({ scope, description });
    });

    return categories;
};

// Get default scopes for a role
export const getDefaultScopesForRole = (role) => {
    return RoleScopes[role] || [];
};

// Validate if scopes are valid
export const validateScopes = (scopes) => {
    const validScopes = getAllScopes();
    const invalidScopes = scopes.filter(scope => !validScopes.includes(scope));

    return {
        isValid: invalidScopes.length === 0,
        invalidScopes,
        validScopes: scopes.filter(scope => validScopes.includes(scope))
    };
};

// Get scopes required for specific operations
export const getRequiredScopesForOperation = (operation) => {
    const operationScopes = {
        // Authentication operations
        'user.login': ['auth:login'],
        'user.register': ['auth:register'],
        'user.logout': ['auth:logout'],
        'user.refresh': ['auth:refresh'],

        // User profile operations
        'user.read': ['user:read'],
        'user.update': ['user:update'],
        'user.delete': ['user:delete'],

        // Business operations
        'business.read': ['business:read'],
        'business.create': ['business:create'],
        'business.update': ['business:update'],
        'business.delete': ['business:delete'],
        'business.manage_members': ['business:manage_members'],
        'business.view_analytics': ['business:view_analytics'],
        'business.export_data': ['business:export_data'],

        // Agent operations
        'agent.read': ['agent:read'],
        'agent.create': ['agent:create'],
        'agent.update': ['agent:update'],
        'agent.delete': ['agent:delete'],
        'agent.deploy': ['agent:deploy'],
        'agent.test': ['agent:test'],
        'agent.view_conversations': ['agent:view_conversations'],
        'agent.manage_prompts': ['agent:manage_prompts'],

        // Collection operations
        'collection.read': ['collection:read'],
        'collection.create': ['collection:create'],
        'collection.update': ['collection:update'],
        'collection.delete': ['collection:delete'],
        'collection.upload_files': ['collection:upload_files'],
        'collection.manage_permissions': ['collection:manage_permissions'],

        // Channel operations
        'channel.read': ['channel:read'],
        'channel.create': ['channel:create'],
        'channel.update': ['channel:update'],
        'channel.delete': ['channel:delete'],
        'channel.connect': ['channel:connect'],
        'channel.view_webhooks': ['channel:view_webhooks'],

        // Action operations
        'action.read': ['action:read'],
        'action.create': ['action:create'],
        'action.update': ['action:update'],
        'action.delete': ['action:delete'],
        'action.test': ['action:test'],
        'action.manage_integrations': ['action:manage_integrations'],

        // Conversation operations
        'conversation.read': ['conversation:read'],
        'conversation.create': ['conversation:create'],
        'conversation.update': ['conversation:update'],
        'conversation.delete': ['conversation:delete'],
        'conversation.export': ['conversation:export'],
        'conversation.analyze': ['conversation:analyze'],

        // Ticket operations
        'ticket.read': ['ticket:read'],
        'ticket.create': ['ticket:create'],
        'ticket.update': ['ticket:update'],
        'ticket.delete': ['ticket:delete'],
        'ticket.assign': ['ticket:assign'],
        'ticket.escalate': ['ticket:escalate'],

        // Analytics operations
        'analytics.read': ['analytics:read'],
        'analytics.export': ['analytics:export'],
        'analytics.custom_reports': ['analytics:custom_reports'],
        'analytics.real_time': ['analytics:real_time'],

        // File operations
        'file.upload': ['file:upload'],
        'file.download': ['file:download'],
        'file.delete': ['file:delete'],
        'file.share': ['file:share'],

        // Template operations
        'template.read': ['template:read'],
        'template.create': ['template:create'],
        'template.update': ['template:update'],
        'template.delete': ['template:delete'],
        'template.publish': ['template:publish'],
        'template.subscribe': ['template:subscribe'],

        // Admin operations
        'admin.users': ['admin:users'],
        'admin.businesses': ['admin:businesses'],
        'admin.system_settings': ['admin:system_settings'],
        'admin.logs': ['admin:logs'],
        'admin.backup': ['admin:backup'],
        'admin.updates': ['admin:updates'],

        // Super admin operations
        'super.all': ['super:all'],
        'super.platform_management': ['super:platform_management'],
        'super.billing': ['super:billing'],
        'super.support': ['super:support'],
        'super.marketplace': ['super:marketplace'],

        // Webhook operations
        'webhook.read': ['webhook:read'],
        'webhook.create': ['webhook:create'],
        'webhook.update': ['webhook:update'],
        'webhook.delete': ['webhook:delete'],
        'webhook.test': ['webhook:test'],

        // Subscription operations
        'subscription.read': ['subscription:read'],
        'subscription.upgrade': ['subscription:upgrade'],
        'subscription.downgrade': ['subscription:downgrade'],
        'subscription.cancel': ['subscription:cancel'],
        'subscription.billing': ['subscription:billing']
    };

    return operationScopes[operation] || [];
};

// Check if user has required scopes for operation
export const hasRequiredScopesForOperation = (user, operation) => {
    const requiredScopes = getRequiredScopesForOperation(operation);
    return user.hasAllScopes(requiredScopes);
};

// Get missing scopes for operation
export const getMissingScopesForOperation = (user, operation) => {
    const requiredScopes = getRequiredScopesForOperation(operation);
    return requiredScopes.filter(scope => !user.hasScope(scope));
};

// Generate scope audit report
export const generateScopeAuditReport = (user) => {
    const allOperations = Object.keys(getRequiredScopesForOperation(''));
    const report = {
        userId: user._id,
        role: user.role,
        currentScopes: user.scopes,
        operationAccess: {},
        missingScopes: [],
        recommendations: []
    };

    allOperations.forEach(operation => {
        const hasAccess = hasRequiredScopesForOperation(user, operation);
        const missingScopes = getMissingScopesForOperation(user, operation);

        report.operationAccess[operation] = {
            hasAccess,
            missingScopes
        };

        if (!hasAccess) {
            report.missingScopes.push(...missingScopes);
        }
    });

    // Remove duplicates from missing scopes
    report.missingScopes = [...new Set(report.missingScopes)];

    // Generate recommendations
    if (report.missingScopes.length > 0) {
        report.recommendations.push(`Consider adding missing scopes: ${report.missingScopes.join(', ')}`);
    }

    return report;
};

// Scope hierarchy helper
export const getScopeHierarchy = () => {
    return {
        'super:all': {
            description: 'Super admin has access to everything',
            includes: getAllScopes().filter(scope => scope !== 'super:all')
        },
        'admin:users': {
            description: 'Can manage all users',
            includes: ['user:read', 'user:update', 'user:delete']
        },
        'admin:businesses': {
            description: 'Can manage all businesses',
            includes: ['business:read', 'business:create', 'business:update', 'business:delete']
        },
        'analytics:read': {
            description: 'Can view analytics',
            includes: ['business:view_analytics']
        }
    };
};

// Export scope constants for easy access
export { ScopesEnum, RoleScopes }; 