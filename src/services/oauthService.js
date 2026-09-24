import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { GraphQLError } from "graphql";
import {
    OAuthClient,
    OAuthAuthorizationCode,
    OAuthRefreshToken,
    OAuthRevokedJti,
    User,
} from "@avakado.ai/schemas";
import { dashboardOrigin } from "./passwordReset.js";

const { ACCESS_SECRET } = process.env;

export const DASHBOARD_CLIENT_ID = process.env.AVA_DASHBOARD_CLIENT_ID || "ava_dashboard";
export const OAUTH_ISSUER = process.env.OAUTH_ISSUER || "https://app.avakado.ai";
export const OAUTH_AUDIENCE = "ava";

export const ACCESS_TTL = process.env.OAUTH_ACCESS_TTL || "1h";
export const ACCESS_TTL_SECONDS = 60 * 60;
export const PERMANENT_TTL = process.env.OAUTH_PERMANENT_TTL || "3650d";
export const CODE_TTL_MS = 2 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SSO_TTL = "8h";

export class OAuthError extends Error {
    constructor(error, description, status = 400) {
        super(description || error);
        this.error = error;
        this.error_description = description;
        this.status = status;
    }
}

export function sha256Hex(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashesEqual(a, b) {
    if (!a || !b) return false;
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

export function clientIdFromUserId(userId) {
    return `ava_${userId}`;
}

export function generateClientSecret() {
    return `ava_sk_${crypto.randomBytes(32).toString("hex")}`;
}

function opaqueToken() {
    return crypto.randomBytes(32).toString("base64url");
}

function verifyPkce(verifier, challenge, method = "S256") {
    if (!challenge) return !verifier;
    if (!verifier) return false;
    if (method === "plain") return hashesEqual(verifier, challenge);
    const digest = crypto.createHash("sha256").update(verifier).digest("base64url");
    return hashesEqual(digest, challenge);
}

export function firstPartyOrigins() {
    const origin = dashboardOrigin();
    return [
        origin,
        "https://app.avakado.ai",
        "https://www.avakado.ai",
        "https://avakado.ai",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
    ];
}

export function firstPartyRedirects() {
    const origin = dashboardOrigin();
    return [
        `${origin}/oauth/callback`,
        "https://app.avakado.ai/oauth/callback",
        "http://localhost:5173/oauth/callback",
        "http://localhost:5174/oauth/callback",
        "http://localhost:3000/oauth/callback",
    ];
}

export async function ensureDashboardClient() {
    const clientId = DASHBOARD_CLIENT_ID;
    const existing = await OAuthClient.findOne({ clientId });
    if (existing) return existing;
    try {
        return await OAuthClient.findOneAndUpdate(
            { clientId },
            {
                $setOnInsert: {
                    clientId,
                    name: "Ava Dashboard",
                    secretHash: null,
                    secretVersion: 1,
                    redirectUris: firstPartyRedirects(),
                    allowedOrigins: firstPartyOrigins(),
                    grantMode: "access_refresh",
                    isFirstParty: true,
                    revokedAt: null,
                },
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        // Two PM2 workers can both miss findOne and then hit clientId_1.
        if (error?.code === 11000) {
            const raced = await OAuthClient.findOne({ clientId });
            if (raced) return raced;
        }
        throw error;
    }
}

export async function findActiveClient(clientId) {
    if (!clientId) return null;
    const client = await OAuthClient.findOne({ clientId });
    if (!client || client.revokedAt) return null;
    return client;
}

export function assertRedirectUri(client, redirectUri) {
    if (!redirectUri || !client.redirectUris?.includes(redirectUri)) {
        throw new OAuthError("invalid_request", "redirect_uri is not registered for this client");
    }
}

export function originAllowedForClient(client, origin) {
    if (!origin) return true;
    return Array.isArray(client.allowedOrigins) && client.allowedOrigins.includes(origin);
}

export async function originAllowed(origin) {
    if (!origin) return true;
    if (firstPartyOrigins().includes(origin)) return true;
    const hit = await OAuthClient.exists({ allowedOrigins: origin, revokedAt: null });
    return Boolean(hit);
}

export function verifyClientSecret(client, secret) {
    if (!client.secretHash) return !secret;
    if (!secret) return false;
    return hashesEqual(client.secretHash, sha256Hex(secret));
}

function scopeString(user) {
    return Array.isArray(user.scopes) ? user.scopes.join(" ") : "";
}

function accessExpiresIn(grantMode) {
    return grantMode === "permanent" ? PERMANENT_TTL : ACCESS_TTL;
}

function tokenUse(grantMode) {
    return grantMode === "permanent" ? "permanent" : "access";
}

/** Access JWT claims: { iss, aud, sub, id, cid, sv, jti, scope, token_use, exp, iat }. Socket.IO/Chat only read `id`. */
export function signAccessToken(user, client, expiresInOverride) {
    const jti = crypto.randomUUID();
    const expiresIn = expiresInOverride || accessExpiresIn(client.grantMode);
    const payload = {
        id: String(user._id),
        sub: String(user._id),
        cid: client.clientId,
        sv: client.secretVersion,
        jti,
        scope: scopeString(user),
        token_use: tokenUse(client.grantMode),
    };
    const token = jwt.sign(payload, ACCESS_SECRET, {
        expiresIn,
        issuer: OAUTH_ISSUER,
        audience: OAUTH_AUDIENCE,
    });
    const decoded = jwt.decode(token);
    return { token, jti, exp: decoded?.exp, expiresIn };
}

export function signSsoToken(user) {
    return jwt.sign(
        { id: String(user._id), token_use: "sso" },
        ACCESS_SECRET,
        { expiresIn: SSO_TTL, issuer: OAUTH_ISSUER, audience: OAUTH_AUDIENCE }
    );
}

export function readSsoUserId(token) {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, ACCESS_SECRET, { issuer: OAUTH_ISSUER, audience: OAUTH_AUDIENCE });
        if (decoded?.token_use !== "sso" || !decoded.id) return null;
        return decoded.id;
    } catch {
        return null;
    }
}

async function persistRefresh({ user, client, familyId }) {
    const refreshToken = opaqueToken();
    const family = familyId || crypto.randomUUID();
    await OAuthRefreshToken.create({
        tokenHash: sha256Hex(refreshToken),
        clientId: client.clientId,
        user: user._id,
        familyId: family,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return { refreshToken, familyId: family };
}

export async function issueTokenSet(user, client, { familyId, expiresIn } = {}) {
    const access = signAccessToken(user, client, expiresIn);
    const result = {
        token_type: "Bearer",
        access_token: access.token,
        expires_in: client.grantMode === "permanent" ? 3650 * 24 * 60 * 60 : ACCESS_TTL_SECONDS,
        scope: scopeString(user),
    };
    if (client.grantMode === "access_refresh") {
        const refresh = await persistRefresh({ user, client, familyId });
        result.refresh_token = refresh.refreshToken;
        result.familyId = refresh.familyId;
    }
    return result;
}

export async function issueAuthorizationCode({ client, user, redirectUri, scope, codeChallenge, codeChallengeMethod }) {
    assertRedirectUri(client, redirectUri);
    if (client.isFirstParty && !codeChallenge) {
        throw new OAuthError("invalid_request", "PKCE code_challenge is required for this client");
    }
    const code = opaqueToken();
    await OAuthAuthorizationCode.create({
        codeHash: sha256Hex(code),
        clientId: client.clientId,
        user: user._id,
        redirectUri,
        scope: scope || scopeString(user),
        codeChallenge: codeChallenge || null,
        codeChallengeMethod: codeChallenge ? (codeChallengeMethod || "S256") : null,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
}

export async function consumeAuthorizationCode({ code, client, redirectUri, codeVerifier }) {
    if (!code) throw new OAuthError("invalid_request", "code is required");
    const record = await OAuthAuthorizationCode.findOne({ codeHash: sha256Hex(code) });
    if (!record || record.clientId !== client.clientId) {
        throw new OAuthError("invalid_grant", "Authorization code is invalid");
    }
    if (record.consumedAt) throw new OAuthError("invalid_grant", "Authorization code has already been used");
    if (record.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "Authorization code expired");
    if (record.redirectUri !== redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match");
    if (record.codeChallenge && !verifyPkce(codeVerifier, record.codeChallenge, record.codeChallengeMethod || "S256")) {
        throw new OAuthError("invalid_grant", "PKCE verification failed");
    }
    record.consumedAt = new Date();
    await record.save();
    const user = await User.findById(record.user).select("-password");
    if (!user) throw new OAuthError("invalid_grant", "User no longer exists");
    return { user, record };
}

export async function authenticateClient({ clientId, clientSecret, codeVerifier }) {
    const client = await findActiveClient(clientId);
    if (!client) throw new OAuthError("invalid_client", "Unknown or revoked client", 401);
    if (client.secretHash) {
        if (!verifyClientSecret(client, clientSecret)) {
            throw new OAuthError("invalid_client", "Invalid client secret", 401);
        }
    } else if (!codeVerifier && !client.isFirstParty) {
        throw new OAuthError("invalid_client", "Client authentication failed", 401);
    }
    return client;
}

export async function exchangeAuthorizationCode(params) {
    const client = await authenticateClient({
        clientId: params.clientId || params.client_id,
        clientSecret: params.clientSecret || params.client_secret,
        codeVerifier: params.codeVerifier || params.code_verifier,
    });
    const { user } = await consumeAuthorizationCode({
        code: params.code,
        client,
        redirectUri: params.redirect_uri,
        codeVerifier: params.code_verifier,
    });
    return issueTokenSet(user, client);
}

export async function revokeRefreshFamily({ familyId, userId, clientId }) {
    const filter = { revokedAt: null };
    if (familyId) filter.familyId = familyId;
    if (clientId) filter.clientId = clientId;
    if (userId) filter.user = userId;
    if (!familyId && !clientId && !userId) return 0;
    const result = await OAuthRefreshToken.updateMany(filter, { $set: { revokedAt: new Date() } });
    return result.modifiedCount || 0;
}

export async function rotateRefreshToken({ refreshToken, clientId, clientSecret }) {
    if (!refreshToken) throw new OAuthError("invalid_request", "refresh_token is required");
    const hash = sha256Hex(refreshToken);
    const stored = await OAuthRefreshToken.findOne({ tokenHash: hash });
    if (!stored) throw new OAuthError("invalid_grant", "Invalid refresh token");

    const client = await authenticateClient({ clientId: clientId || stored.clientId, clientSecret });
    if (stored.clientId !== client.clientId) throw new OAuthError("invalid_grant", "Refresh token does not belong to this client");
    if (client.grantMode !== "access_refresh") {
        throw new OAuthError("unauthorized_client", "This client does not use refresh tokens");
    }

    if (stored.revokedAt || stored.usedAt) {
        await revokeRefreshFamily({ familyId: stored.familyId });
        throw new OAuthError("invalid_grant", "Refresh token reuse detected");
    }
    if (stored.expiresAt.getTime() < Date.now()) {
        stored.revokedAt = new Date();
        await stored.save();
        throw new OAuthError("invalid_grant", "Refresh token expired");
    }

    stored.usedAt = new Date();
    stored.revokedAt = new Date();
    await stored.save();

    const user = await User.findById(stored.user).select("-password");
    if (!user) throw new OAuthError("invalid_grant", "User no longer exists");
    return issueTokenSet(user, client, { familyId: stored.familyId });
}

export async function revokeAccessJti(jti, exp) {
    if (!jti) return;
    const expiresAt = exp ? new Date(exp * 1000) : new Date(Date.now() + ACCESS_TTL_SECONDS * 1000);
    await OAuthRevokedJti.updateOne({ jti }, { $set: { jti, expiresAt } }, { upsert: true });
}

export async function isJtiRevoked(jti) {
    if (!jti) return false;
    return Boolean(await OAuthRevokedJti.exists({ jti }));
}

export async function revokeToken({ token, tokenTypeHint, clientId, clientSecret }) {
    if (!token) return;
    if (tokenTypeHint !== "access_token") {
        const stored = await OAuthRefreshToken.findOne({ tokenHash: sha256Hex(token) });
        if (stored) {
            if (clientId && stored.clientId !== clientId) return;
            await revokeRefreshFamily({ familyId: stored.familyId });
            return;
        }
    }
    try {
        const decoded = jwt.verify(token, ACCESS_SECRET, { ignoreExpiration: true });
        if (clientId && decoded.cid && decoded.cid !== clientId) return;
        await revokeAccessJti(decoded.jti, decoded.exp);
        if (decoded.id) await revokeRefreshFamily({ userId: decoded.id, ...(decoded.cid ? { clientId: decoded.cid } : {}) });
    } catch {
        // RFC 7009: invalid tokens still 200
    }
}

export async function verifyAccessJwt(accessToken) {
    if (!accessToken) return { success: false, message: "No access token provided", data: { decoded: null } };
    try {
        const decoded = jwt.verify(accessToken, ACCESS_SECRET);
        if (!decoded || !decoded.id) return { success: false, message: "Invalid access token payload", data: { decoded: null } };
        if (decoded.token_use === "sso") {
            return { success: false, message: "SSO token cannot be used as an access token", data: { decoded: null } };
        }
        if (decoded.jti && await isJtiRevoked(decoded.jti)) {
            return { success: false, message: "Access token revoked", data: { decoded: null } };
        }
        if (decoded.cid && decoded.sv != null) {
            const client = await OAuthClient.findOne({ clientId: decoded.cid });
            if (!client || client.revokedAt) {
                return { success: false, message: "OAuth client revoked", data: { decoded: null } };
            }
            if (Number(decoded.sv) !== Number(client.secretVersion)) {
                return { success: false, message: "OAuth client secret rotated", data: { decoded: null } };
            }
        }
        return { success: true, message: "Valid Access Token", data: { decoded } };
    } catch (error) {
        const message = error.name === "JsonWebTokenError" ? "Invalid access token" : error.name === "TokenExpiredError" ? "jwt expired" : error.message;
        return { success: false, message, data: { decoded: null } };
    }
}

export async function authenticatePassword(email, password) {
    const user = await User.findOne({ email });
    if (!user || !user._id) throw new GraphQLError("Invalid email", { extensions: { code: "UNAUTHENTICATED" } });
    if (!bcrypt.compareSync(password, user.password)) throw new GraphQLError("Invalid password", { extensions: { code: "UNAUTHENTICATED" } });
    if (!user.isVerified) throw new GraphQLError("Email not verified", { extensions: { code: "UNAUTHENTICATED" } });
    const safe = user.toObject();
    delete safe.password;
    return { user, userResponse: safe };
}

export async function issueDashboardTokens(user) {
    const client = await ensureDashboardClient();
    return issueTokenSet(user, client);
}

export async function createUserOauthClient({ user, name, redirectUris, allowedOrigins, grantMode }) {
    const existing = await OAuthClient.findOne({ createdBy: user._id });
    if (existing) {
        throw new GraphQLError("You already have an OAuth client. Rotate the secret instead.", { extensions: { code: "CLIENT_EXISTS" } });
    }
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
        throw new GraphQLError("At least one redirect URI is required", { extensions: { code: "BAD_USER_INPUT" } });
    }
    const secret = generateClientSecret();
    const client = await OAuthClient.create({
        clientId: clientIdFromUserId(user._id),
        name: name || `${user.name || "Ava"} API`,
        business: user.business,
        createdBy: user._id,
        secretHash: sha256Hex(secret),
        secretVersion: 1,
        redirectUris: redirectUris || [],
        allowedOrigins: allowedOrigins || [],
        grantMode: grantMode || "access_refresh",
        isFirstParty: false,
    });
    return { client, clientSecret: secret };
}

export async function findMutableOauthClient(user) {
    if (!user?._id) return null;
    const mine = await OAuthClient.findOne({ createdBy: user._id, isFirstParty: { $ne: true } });
    if (mine) return mine;
    const isAdmin = user.role === "admin" || user.role === "superAdmin";
    if (!isAdmin) return null;
    return OAuthClient.findOne({ business: user.business, isFirstParty: { $ne: true } });
}

export function assertCanManageOauthClient(user, client) {
    if (!client) {
        throw new GraphQLError("OAuth client not found", { extensions: { code: "NOT_FOUND" } });
    }
    const isCreator = String(client.createdBy) === String(user._id);
    const isAdmin = user.role === "admin" || user.role === "superAdmin";
    if (!isCreator && !isAdmin) {
        throw new GraphQLError("Only the creator or an admin can manage this client", { extensions: { code: "FORBIDDEN" } });
    }
    return client;
}

export async function rotateOauthClientSecret(client) {
    const secret = generateClientSecret();
    client.secretHash = sha256Hex(secret);
    client.secretVersion = (client.secretVersion || 1) + 1;
    await client.save();
    await revokeRefreshFamily({ clientId: client.clientId });
    return { client, clientSecret: secret };
}

export async function publicClientView(client) {
    if (!client) return null;
    return {
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.redirectUris || [],
        allowedOrigins: client.allowedOrigins || [],
        grantMode: client.grantMode,
        secretVersion: client.secretVersion,
        revokedAt: client.revokedAt,
        createdAt: client.createdAt,
        isFirstParty: client.isFirstParty,
    };
}
