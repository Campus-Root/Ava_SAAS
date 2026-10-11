import crypto from "crypto";

/** Long enough for one dashboard's parallel queries. Short enough that a revoked token dies quickly. */
export const SESSION_CACHE_MS = 5_000;
const sessions = new Map();

function keyFor(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** The user already verified for this exact token, or null. */
export function readSession(token) {
    if (!token) return null;
    const key = keyFor(token);
    const hit = sessions.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        sessions.delete(key);
        return null;
    }
    return hit.user;
}

export function rememberSession(token, user, { jti, cid } = {}) {
    if (!token || !user?._id) return;
    sessions.set(keyFor(token), {
        expiresAt: Date.now() + SESSION_CACHE_MS,
        user,
        jti: jti || null,
        cid: cid || null,
    });
    if (sessions.size <= 1000) return;
    const now = Date.now();
    for (const [key, entry] of sessions) {
        if (entry.expiresAt <= now) sessions.delete(key);
    }
}

export function forgetSessionByJti(jti) {
    if (!jti) return;
    for (const [key, entry] of sessions) {
        if (entry.jti === jti) sessions.delete(key);
    }
}

export function forgetSessionsForClient(clientId) {
    if (!clientId) return;
    for (const [key, entry] of sessions) {
        if (entry.cid === clientId) sessions.delete(key);
    }
}
