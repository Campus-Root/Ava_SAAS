import { User } from '@avakado.ai/schemas';
import { Business } from '@avakado.ai/schemas';
import bcrypt from 'bcryptjs';
import {
    getAllScopes,
    getScopesByCategory,
    getDefaultScopesForRole,
    validateScopes,
    generateScopeAuditReport,
    getScopeDescription
} from '../../utils/scopeManager.js';
import graphqlFields from 'graphql-fields';
import { flattenFields } from '../../utils/graphqlTools.js';
import AuthService from '../../services/authService.js';
import { setRefreshCookie, setSsoCookie } from '../../utils/authCookies.js';
import { GraphQLError } from 'graphql';
import { OpenAiLLM } from '../../utils/openai.js';
import { Subscription } from '@avakado.ai/schemas';
import { OAuthClient } from '@avakado.ai/schemas';
import {
    createUserOauthClient,
    rotateOauthClientSecret,
    publicClientView,
    revokeRefreshFamily,
    findMutableOauthClient,
    assertCanManageOauthClient,
    signSsoToken,
} from '../../services/oauthService.js';

function requireUser(context) {
    if (!context.user) {
        throw new GraphQLError("Authentication required", { extensions: { code: "UNAUTHENTICATED" } });
    }
    return context.user;
}
export const userResolvers = {
    Query: {
        me: async (_, filters, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const user = await User.findById(context.user._id);
            if (projection.business) {
                await Business.populate(user, { path: 'business' });
                await Subscription.populate(user, { path: 'business.credits.currentSubscription' });
            }
            return user
        },
        users: async (_, { id, limit = 10, role, isVerified }, context, info) => {
            const requestedFields = graphqlFields(info, {}, { processArguments: false });
            const { projection, nested } = flattenFields(requestedFields);
            const filter = {};
            filter.business = context.user.business;
            if (role) filter.role = role;
            if (isVerified !== undefined) filter.isVerified = isVerified;
            if (id) filter._id = id
            return await User.find(filter).limit(limit).sort({ createdAt: -1 });
        },
        oauthClient: async (_, __, context) => {
            const user = requireUser(context);
            const mine = await OAuthClient.findOne({ createdBy: user._id, isFirstParty: { $ne: true } });
            if (mine) return publicClientView(mine);
            const shared = await OAuthClient.findOne({ business: user.business, isFirstParty: { $ne: true }, revokedAt: null }).sort({ createdAt: 1 });
            return publicClientView(shared);
        },
    },
    Mutation: {
        createUser: async (_, { user }, context, info) => {
            // Check if email already exists
            const existingUser = await User.findOne({ email: user.email });
            if (existingUser) throw new Error('User with this email already exists');
            // Hash password if provided
            let hashedPassword = null;
            if (user.password) hashedPassword = await bcrypt.hash(user.password, 12);
            // Set business if not provided
            const businessId = context.user.business;
            const newUser = await User.create({ name: user.name, email: user.email, password: hashedPassword, role: user.role, business: businessId, scopes: user.scopes || getDefaultScopesForRole(user.role), isVerified: false });
            return newUser;
        },
        updateUser: async (_, { id, user }, context) => {
            const updateData = { ...user };
            // If role is being changed, update scopes accordingly
            if (user.role) updateData.scopes = getDefaultScopesForRole(user.role);
            return await User.findByIdAndUpdate(id, updateData, { new: true }).populate('business').select('-password');
        },
        deleteUser: async (_, { id }, context) => {
            const result = await User.findByIdAndDelete(id);
            return !!result;
        },
        generateUserAccessToken: async (_, { expiresIn }, context) => {
            const tokens = await AuthService.issueAccessForUser(context.user, expiresIn);
            return tokens.access_token;
        },
        login: async (_, { input }, context) => {
            const { email, password } = input;
            const ipAddress = context.req?.ip || context.req?.connection?.remoteAddress;
            const userAgent = context.req?.get('user-agent');
            const { accessToken, refreshToken, expiresIn, user } = await AuthService.login(email, password, ipAddress, userAgent)
            if (refreshToken) setRefreshCookie(context.res, refreshToken, { maxAge: 30 * 24 * 60 * 60 * 1000 });
            setSsoCookie(context.res, signSsoToken(user), { maxAge: 8 * 60 * 60 * 1000 });
            return { accessToken, role: user.role, scopes: user.scopes || [], user, expiresIn };
        },
        register: async (_, { input }, context) => {
            const ipAddress = context.req?.ip || context.req?.connection?.remoteAddress;
            const userAgent = context.req?.get('user-agent');
            try {
                return await AuthService.register(input, ipAddress, userAgent);
            } catch (error) {
                throw new GraphQLError(error.message || "Registration failed", { extensions: { code: error.extensions?.code || "INTERNAL_SERVER_ERROR" } });
            }
        },
        logout: async (_, __, context) => {
            if (!context.user) throw new GraphQLError('Authentication required', { extensions: { code: 'UNAUTHENTICATED' } });
            return AuthService.logout(context.res, context.user);
        },
        createOauthClient: async (_, { input }, context) => {
            const user = requireUser(context);
            const { client, clientSecret } = await createUserOauthClient({
                user,
                name: input.name,
                redirectUris: input.redirectUris,
                allowedOrigins: input.allowedOrigins || [],
                grantMode: input.grantMode,
            });
            return { client: publicClientView(client), clientSecret };
        },
        updateOauthClient: async (_, { input }, context) => {
            const user = requireUser(context);
            const client = assertCanManageOauthClient(user, await findMutableOauthClient(user));
            if (input.name != null) client.name = input.name;
            if (input.redirectUris) client.redirectUris = input.redirectUris;
            if (input.allowedOrigins) client.allowedOrigins = input.allowedOrigins;
            if (input.grantMode) client.grantMode = input.grantMode;
            await client.save();
            return publicClientView(client);
        },
        rotateOauthClientSecret: async (_, __, context) => {
            const user = requireUser(context);
            const client = assertCanManageOauthClient(user, await findMutableOauthClient(user));
            const rotated = await rotateOauthClientSecret(client);
            return { client: publicClientView(rotated.client), clientSecret: rotated.clientSecret };
        },
        revokeOauthClient: async (_, __, context) => {
            const user = requireUser(context);
            const client = assertCanManageOauthClient(user, await findMutableOauthClient(user));
            client.revokedAt = new Date();
            await client.save();
            await revokeRefreshFamily({ clientId: client.clientId });
            return true;
        },
        requestPasswordReset: async (_, { email }) => AuthService.requestPasswordReset(email),
        forgotPassword: async (_, { email }) => AuthService.requestPasswordReset(email),
        resetPassword: async (_, { token, email, password }) => AuthService.resetPassword({ token, email, password }),

        talkToAi: async (_, { systemInstructions, userQuery, model = "gpt-4o-mini", zodFormat }, context) => {
            const response = await OpenAiLLM({
                input: [{ role: "system", content: systemInstructions }, { role: "user", content: userQuery }],
                model,
                text: { format: zodFormat }
            })
            return response
        },
        // forgotPassword: async (_, { email }, context) => {}
        //     updateUserScopes: async (_, { userId, scopeUpdate }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         const { scopes, operation } = scopeUpdate;

        //         // Validate scopes
        //         const validation = validateScopes(scopes);
        //         if (!validation.isValid) {
        //             throw new Error(`Invalid scopes: ${validation.invalidScopes.join(', ')}`);
        //         }

        //         // Update scopes based on operation
        //         switch (operation) {
        //             case 'add':
        //                 await user.addScopes(validation.validScopes);
        //                 break;
        //             case 'remove':
        //                 await user.removeScopes(validation.validScopes);
        //                 break;
        //             case 'replace':
        //                 user.scopes = validation.validScopes;
        //                 await user.save();
        //                 break;
        //             default:
        //                 throw new Error('Invalid operation. Must be "add", "remove", or "replace"');
        //         }

        //         return await User.findById(userId)
        //             .populate('business')
        //             .select('-password');
        //     },

        //     bulkUpdateUserScopes: async (_, { updates }, context) => {
        //         const results = [];
        //         const errors = [];

        //         for (const update of updates) {
        //             try {
        //                 const { userId, scopes, operation } = update;

        //                 if (!userId || !Array.isArray(scopes) || !operation) {
        //                     errors.push({
        //                         userId,
        //                         error: 'Missing required fields: userId, scopes (array), operation'
        //                     });
        //                     continue;
        //                 }

        //                 // Validate scopes
        //                 const validation = validateScopes(scopes);
        //                 if (!validation.isValid) {
        //                     errors.push({
        //                         userId,
        //                         error: 'Invalid scopes',
        //                         invalidScopes: validation.invalidScopes
        //                     });
        //                     continue;
        //                 }

        //                 const user = await User.findById(userId);
        //                 if (!user) {
        //                     errors.push({
        //                         userId,
        //                         error: 'User not found'
        //                     });
        //                     continue;
        //                 }

        //                 // Update scopes based on operation
        //                 switch (operation) {
        //                     case 'add':
        //                         await user.addScopes(validation.validScopes);
        //                         break;
        //                     case 'remove':
        //                         await user.removeScopes(validation.validScopes);
        //                         break;
        //                     case 'replace':
        //                         user.scopes = validation.validScopes;
        //                         await user.save();
        //                         break;
        //                     default:
        //                         errors.push({
        //                             userId,
        //                             error: 'Invalid operation. Must be "add", "remove", or "replace"'
        //                         });
        //                         continue;
        //                 }

        //                 results.push({
        //                     userId: user._id,
        //                     updatedScopes: user.scopes,
        //                     operation
        //                 });

        //             } catch (error) {
        //                 errors.push({
        //                     userId: update.userId,
        //                     error: error.message
        //                 });
        //             }
        //         }

        //         return {
        //             successful: results,
        //             errors,
        //             summary: {
        //                 total: updates.length,
        //                 successful: results.length,
        //                 failed: errors.length
        //             }
        //         };
        //     },

        //     assignRole: async (_, { userId, role }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         user.role = role;
        //         user.scopes = getDefaultScopesForRole(role);
        //         user.updatedAt = new Date();

        //         await user.save();

        //         return await User.findById(userId)
        //             .populate('business')
        //             .select('-password');
        //     },

        //     assignToBusiness: async (_, { userId, businessId }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         const business = await Business.findById(businessId);
        //         if (!business) {
        //             throw new Error('Business not found');
        //         }

        //         user.business = businessId;
        //         user.updatedAt = new Date();

        //         await user.save();

        //         return await User.findById(userId)
        //             .populate('business')
        //             .select('-password');
        //     },

        //     verifyUser: async (_, { userId }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         user.isVerified = true;
        //         user.updatedAt = new Date();

        //         await user.save();

        //         return await User.findById(userId)
        //             .populate('business')
        //             .select('-password');
        //     },

        //     deactivateUser: async (_, { userId }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         // Add a deactivated flag or use isVerified as a status indicator
        //         user.isVerified = false;
        //         user.updatedAt = new Date();

        //         await user.save();

        //         return await User.findById(userId)
        //             .populate('business')
        //             .select('-password');
        //     },

        //     reactivateUser: async (_, { userId }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         user.isVerified = true;
        //         user.updatedAt = new Date();

        //         await user.save();

        //         return await User.findById(userId)
        //             .populate('business')
        //             .select('-password');
        //     },

        //     resetUserPassword: async (_, { userId }, context) => {
        //         const user = await User.findById(userId);
        //         if (!user) {
        //             throw new Error('User not found');
        //         }

        //         // Generate a random password
        //         const newPassword = Math.random().toString(36).slice(-8);
        //         const hashedPassword = await bcrypt.hash(newPassword, 12);

        //         user.password = hashedPassword;
        //         user.updatedAt = new Date();

        //         await user.save();

        //         // In a real implementation, you would send this password via email
        //         console.log(`New password for user ${user.email}: ${newPassword}`);

        //         return true;
        //     },

        //     sendPasswordResetEmail: async (_, { email }, context) => {
        //         const user = await User.findOne({ email });
        //         if (!user) {
        //             // Don't reveal if user exists or not for security
        //             return true;
        //         }

        //         // In a real implementation, you would send a password reset email
        //         console.log(`Password reset email sent to: ${email}`);

        //         return true;
        //     }
    }
}; 