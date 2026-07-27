import { conversationTypeDefs } from './conversations/schema.js';
import { conversationResolvers } from './conversations/resolvers.js';
import { userTypeDefs } from './users/schema.js';
import { userResolvers } from './users/resolvers.js';
import { sharedTypeDefs } from './shared/types.js';
// import { twilioResolvers } from './twilio/resolver.js';
import { scopeAuthDirectiveTypeDefs, applyScopeAuthDirectives } from './directives/scopeAuth.js';
import { mergeResolvers, mergeTypeDefs } from '@graphql-tools/merge';
import { makeExecutableSchema } from '@graphql-tools/schema';
// import { twilioTypeDefs } from './twilio/schema.js';
import { channelResolvers } from './channels/resolver.js';
import { channelTypeDefs } from './channels/schema.js';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { authForGraphQL } from '../middleware/auth.js';
import 'dotenv/config'
import { GraphQLError, Kind } from 'graphql';
import { corsOptions, openCors } from '../server.js';
import cors from 'cors'
import { ticketResolvers } from './tickets/resolver.js';
import { paymentResolvers } from './payments/resolvers.js';
import { paymentTypeDefs } from './payments/schema.js';
import { ticketTypeDefs } from './tickets/schema.js';
import { notificationTypeDefs } from './notifications/schema.js';
import { notificationResolvers } from './notifications/resolver.js';
import { ApolloServerPluginLandingPageProductionDefault } from '@apollo/server/plugin/landingPage/default';
// import { zohoTypeDefs } from './zoho/schema.js';
// import { zohoResolvers } from './zoho/resolver.js';
import { actionResolvers } from './actions/resolvers.js';
import { actionTypeDefs } from './actions/schema.js';
import { agentResolvers } from './agents/resolvers.js';
import { agentTypeDefs } from './agents/schema.js';
import { collectionResolvers } from './collections/resolvers.js';
import { collectionTypeDefs } from './collections/schema.js';
import { IntegrationTypeDefs } from './integrations/schema.js';
import { IntegrationResolvers } from './integrations/resolver.js';
import { jobResolvers } from './job/resolver.js';
import { jobTypeDefs } from './job/schema.js';
import { messageTypeDefs } from './messages/schema.js';
import { messageResolvers } from './messages/resolver.js';
import { leadTypeDefs } from './leads/schema.js';
import { leadResolvers } from './leads/resolver.js';
import { workflowTypeDefs } from './workflows/schema.js';
import { workflowResolvers } from './workflows/resolvers.js';
import { serviceProvidersTypeDefs } from './serviceProviders/schema.js';
import { serviceProvidersResolvers } from './serviceProviders/resolvers.js';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs'
const typeDefs = mergeTypeDefs([
  scopeAuthDirectiveTypeDefs,
  sharedTypeDefs,
  conversationTypeDefs,
  // twilioTypeDefs,
  channelTypeDefs,
  ticketTypeDefs,
  notificationTypeDefs,
  userTypeDefs,
  IntegrationTypeDefs,
  // zohoTypeDefs,
  serviceProvidersTypeDefs,
  agentTypeDefs,
  actionTypeDefs,
  collectionTypeDefs,
  jobTypeDefs,
  messageTypeDefs,
  leadTypeDefs,
  paymentTypeDefs,
  workflowTypeDefs
]);
const resolvers = mergeResolvers([
  conversationResolvers,
  // twilioResolvers,
  channelResolvers,
  ticketResolvers,
  notificationResolvers,
  userResolvers,
  IntegrationResolvers,
  // zohoResolvers,
  serviceProvidersResolvers,
  agentResolvers,
  actionResolvers,
  collectionResolvers,
  jobResolvers,
  messageResolvers,
  leadResolvers,
  paymentResolvers,
  workflowResolvers
]);
export const registerApollo = async (app, httpServer) => {
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });
  const schemaWithDirectives = applyScopeAuthDirectives(schema);
  const apolloServer = new ApolloServer({
    schema: schemaWithDirectives,
    introspection: true,
    csrfPrevention: true, // ✅ Simple boolean - works with CORS
    formatResponse: (response, requestContext) => {
      if (response.errors) {
        return response; // handled by formatError above
      }
      // Function to recursively remove __typename fields
      const removeTypename = (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(removeTypename);
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key !== '__typename') {
            cleaned[key] = removeTypename(value);
          }
        }
        return cleaned;
      };
      return {
        success: true,
        message: "OK",
        data: removeTypename(response.data),
      };
    },
    formatError: (error) => {
      console.error('GraphQL Error Details:', { message: error.message, code: error.extensions?.code });
      switch (error.code) {
        case 20003:
          return new GraphQLError("Authentication failed - check your credentials.", { extensions: { code: 'AUTHENTICATION_FAILED' } });
        case 21211:
          return new GraphQLError("Invalid phone number format.", { extensions: { code: 'INVALID_PHONE_NUMBER' } });
        case 21408:
          return new GraphQLError("Permission denied - check account permissions.", { extensions: { code: 'INVALID_ACCESS' } });
        case 21610:
          return new GraphQLError("Message body is required.", { extensions: { code: 'MESSAGE_BODY_REQUIRED' } });
        case 30007:
          return new GraphQLError("Message delivery failed.", { extensions: { code: 'MESSAGE_DELIVERY_FAILED' } });
      }
      if (error.status === 400) return new GraphQLError("Bad Request - Invalid parameters.", { extensions: { code: 'BAD_REQUEST' } });
      if (error.status === 401) return new GraphQLError("Unauthorized - Authentication failed.", { extensions: { code: 'UNAUTHORIZED' } });
      if (error.status === 403) return new GraphQLError("Forbidden - Insufficient permissions.", { extensions: { code: 'FORBIDDEN' } });
      if (error.status === 429) return new GraphQLError("Too Many Requests - Rate limited.", { extensions: { code: 'RATE_LIMITED' } });
      if (error.message.includes('Context creation failed')) return new GraphQLError('Authentication service unavailable', { extensions: { code: 'AUTH_SERVICE_UNAVAILABLE' } });
      return new GraphQLError(error.message, {
        extensions: {
          ...error.extensions,
          code: error.code || error.extensions?.code,
        },
      });
    },
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer }), ApolloServerPluginLandingPageProductionDefault({ embed: true }),
    {
      async requestDidStart(requestContext) {
        return {
          async willSendResponse(ctx) {
            let rootOperation = null;
            let operationName = ctx.operationName || null;
            let rootFields = [];
            if (ctx.document) {
              for (const def of ctx.document.definitions) {
                if (def.kind === Kind.OPERATION_DEFINITION) {
                  // 1️⃣ query / mutation / subscription
                  rootOperation = def.operation;
                  // 2️⃣ operation name
                  operationName = def.name?.value || 'Anonymous';
                  // 3️⃣ root fields (main resolvers)
                  rootFields = def.selectionSet.selections.filter(sel => sel.kind === Kind.FIELD).map(field => field.name.value);
                }
              }
            }
            // query: ctx.request.query,
            // variables: ctx.request.variables,
            console.log(`userId: ${ctx.contextValue?.user?._id} - ${rootOperation} -> ${operationName} => ${rootFields}`);
          }
        };
      }
    }
    ],
  });
  await apolloServer.start();

  // List of operations that should skip authentication (public operations)
  const publicOperations = [
    'IntrospectionQuery',
    'login',
    'Login',
    'Register',
    'register',
    'forgotPassword',
    'ephemeralToken',
    'EphemeralToken',
    'startDemo',
    'endDemo',
    'StartDemo',
    'EndDemo',
  ];

  // Helper function to extract operation name from GraphQL query
  const extractOperationName = (req) => {
    // First check operationName directly (this is the most reliable)
    if (req.body?.operationName) return req.body.operationName;

    // If not found, try to parse from query string
    const query = req.body?.query;
    if (typeof query === 'string') {
      // Match named operation patterns like: mutation Login, query SomeQuery, etc.
      const namedOperationMatch = query.match(/(?:mutation|query|subscription)\s+(\w+)/);
      if (namedOperationMatch && namedOperationMatch[1]) {
        return namedOperationMatch[1];
      }
      // For anonymous operations, extract the first field name
      // Handles patterns like: mutation { login(...) } or query { me }
      const anonymousOperationMatch = query.match(/(?:mutation|query|subscription)\s*\{\s*(\w+)\s*\(?/);
      if (anonymousOperationMatch && anonymousOperationMatch[1]) {
        return anonymousOperationMatch[1];
      }
    }
    // For batched queries
    if (Array.isArray(req.body)) {
      for (const item of req.body) {
        if (item.operationName) return item.operationName;
        if (item.query) {
          const namedOpMatch = item.query.match(/(?:mutation|query|subscription)\s+(\w+)/);
          if (namedOpMatch && namedOpMatch[1]) return namedOpMatch[1];
          const anonOpMatch = item.query.match(/(?:mutation|query|subscription)\s*\{\s*(\w+)\s*\(?/);
          if (anonOpMatch && anonOpMatch[1]) return anonOpMatch[1];
        }
      }
    }
    return null;
  };
  // ✅ 1. MUST BE FIRST - before any body parser
  app.use('/graphql', graphqlUploadExpress({
    maxFileSize: 100000000,
    maxFiles: 5
  }));

  // console.log('✅ graphqlUploadExpress middleware loaded');
  // ✅ 3. Debug middleware
  // app.use('/graphql', (req, res, next) => {
  //   console.log('📤 After upload middleware');
  //   console.log('Body:', req.body ? Object.keys(req.body) : 'no body');
  //   next();
  // });



  app.use('/graphql', cors(corsOptions))
  app.use('/graphql', expressMiddleware(apolloServer, {
    context: async ({ req, res }) => {
      try {
        const operationName = extractOperationName(req);
        if (operationName && publicOperations.includes(operationName)) {
          console.log(`Allowing public operation: ${operationName}`);
          return { user: null, isAuthenticated: false, isPublicOperation: true };
        }
        const authResult = await authForGraphQL(req, res);
        return authResult;
      } catch (error) {
        console.error('Auth error details:', { message: error.message, stack: error.stack, headers: req.headers, body: req.body });
        if (error.message === 'Internal Server Error') throw new Error('Authentication failed: Unable to verify credentials');
        throw error;
      }
    },
  })
  )
}