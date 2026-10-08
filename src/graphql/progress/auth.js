import { GraphQLError } from 'graphql';
import { REFRESH_COOKIE_NAME } from '../../utils/authCookies.js';
import { authenticateBearer } from '../../middleware/auth.js';

function cookiesFromHeader(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function bearerFrom(ctx) {
  const params = ctx.connectionParams || {};
  const fromParams = params.authorization
    || params.Authorization
    || params.authToken
    || params.headers?.authorization
    || params.headers?.Authorization;
  return fromParams || ctx.extra?.request?.headers?.authorization || '';
}

export function assertUser(context, scope) {
  const user = context?.user;
  if (!user) {
    throw new GraphQLError('Authentication required', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  if (user.role !== 'superAdmin' && !user.business) {
    throw new GraphQLError('Business access required', { extensions: { code: 'FORBIDDEN' } });
  }
  if (scope && typeof user.hasScope === 'function' && !user.hasScope(scope)) {
    throw new GraphQLError(`Insufficient permissions. Required scope: ${scope}`, {
      extensions: { code: 'FORBIDDEN', requiredScope: scope },
    });
  }
  return user;
}

export async function subscriptionContext(ctx) {
  if (ctx.avaAuth) return ctx.avaAuth;
  const raw = String(bearerFrom(ctx) || '').trim();
  if (!raw) throw new GraphQLError('Access Token Missing', { extensions: { code: 'UNAUTHENTICATED' } });
  const token = raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw;
  if (!token || token === 'null' || token === 'undefined') {
    throw new GraphQLError('Access Token Missing', { extensions: { code: 'UNAUTHENTICATED' } });
  }

  const req = ctx.extra?.request || { headers: {}, cookies: {} };
  if (!req.cookies) req.cookies = cookiesFromHeader(req.headers?.cookie);
  else if (!req.cookies[REFRESH_COOKIE_NAME] && req.headers?.cookie) {
    req.cookies = { ...cookiesFromHeader(req.headers.cookie), ...req.cookies };
  }
  const res = { setHeader() {}, getHeader() { return undefined; } };
  const session = await authenticateBearer(req, res, token);
  if (session.error) {
    throw new GraphQLError(`Token Verification Failed: ${session.error}`, { extensions: { code: 'UNAUTHENTICATED' } });
  }
  ctx.avaAuth = { req, res, user: session.user, isAuthenticated: true, accessToken: session.accessToken };
  return ctx.avaAuth;
}
