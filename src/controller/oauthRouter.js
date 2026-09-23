import { Router } from "express";
import cors from "cors";
import {
    OAuthError,
    findActiveClient,
    assertRedirectUri,
    originAllowed,
    originAllowedForClient,
    issueAuthorizationCode,
    exchangeAuthorizationCode,
    rotateRefreshToken,
    revokeToken,
    verifyAccessJwt,
    authenticatePassword,
    readSsoUserId,
    signSsoToken,
    ensureDashboardClient,
    DASHBOARD_CLIENT_ID,
} from "../services/oauthService.js";
import { User } from "@avakado.ai/schemas";
import {
    SSO_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    setSsoCookie,
    setRefreshCookie,
    clearRefreshCookie,
} from "../utils/authCookies.js";

export const oauthRouter = Router();

function oauthJsonError(res, err) {
    const status = err.status || 400;
    const error = err.error || "invalid_request";
    const description = err.error_description || err.message || "invalid_request";
    return res.status(status).json({ error, error_description: description });
}

function redirectError(redirectUri, error, state, description) {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (description) url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return url.toString();
}

function authorizeQuery(req) {
    const src = { ...req.query, ...req.body };
    return {
        response_type: src.response_type,
        client_id: src.client_id,
        redirect_uri: src.redirect_uri,
        state: src.state,
        scope: src.scope,
        code_challenge: src.code_challenge,
        code_challenge_method: src.code_challenge_method || "S256",
        email: src.email,
        password: src.password,
    };
}

function authorizePage({ error, client, query }) {
    const hidden = ["response_type", "client_id", "redirect_uri", "state", "scope", "code_challenge", "code_challenge_method"]
        .map((name) => `<input type="hidden" name="${name}" value="${String(query[name] ?? "").replace(/"/g, "&quot;")}" />`)
        .join("");
    const err = error ? `<p class="err">${String(error).replace(/</g, "")}</p>` : "";
    const appName = client?.name || "Ava";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in to Ava</title>
  <style>
    body { margin:0; font-family: Avenir Next, Segoe UI, sans-serif; background:#f6f1e6; color:#1c1914; }
    main { max-width: 28rem; margin: 12vh auto; background:#fff; padding:2rem; border-radius:12px; border:1px solid #e4ddd0; }
    h1 { font-family: Palatino, Georgia, serif; color:#12352c; margin:0 0 .4rem; }
    p { color:#5b574e; }
    label { display:block; font-size:.85rem; margin: .9rem 0 .25rem; }
    input[type=email], input[type=password] { width:100%; box-sizing:border-box; padding:.65rem .7rem; border:1px solid #d7d0c3; border-radius:8px; }
    button { margin-top:1.2rem; width:100%; background:#12352c; color:#f6f1e6; border:0; padding:.75rem; border-radius:8px; font-weight:600; cursor:pointer; }
    .err { color:#8a2b2b; background:#f8e8e8; padding:.6rem .7rem; border-radius:8px; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in to Ava</h1>
    <p>Continue to <strong>${String(appName).replace(/</g, "")}</strong></p>
    ${err}
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <label>Email</label>
      <input type="email" name="email" autocomplete="username" required />
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required />
      <button type="submit">Authorize</button>
    </form>
  </main>
</body>
</html>`;
}

async function completeAuthorize(req, res, user, query) {
    const client = await findActiveClient(query.client_id);
    if (!client) return res.status(400).send("Unknown client");
    try {
        assertRedirectUri(client, query.redirect_uri);
    } catch (err) {
        return res.status(400).send(err.message);
    }
    if (query.response_type !== "code") {
        return res.redirect(redirectError(query.redirect_uri, "unsupported_response_type", query.state));
    }
    try {
        const code = await issueAuthorizationCode({
            client,
            user,
            redirectUri: query.redirect_uri,
            scope: query.scope,
            codeChallenge: query.code_challenge,
            codeChallengeMethod: query.code_challenge_method,
        });
        const url = new URL(query.redirect_uri);
        url.searchParams.set("code", code);
        if (query.state) url.searchParams.set("state", query.state);
        setSsoCookie(res, signSsoToken(user), { maxAge: 8 * 60 * 60 * 1000 });
        return res.redirect(url.toString());
    } catch (err) {
        if (err instanceof OAuthError) {
            return res.redirect(redirectError(query.redirect_uri, err.error, query.state, err.error_description));
        }
        throw err;
    }
}

oauthRouter.get("/authorize", async (req, res) => {
    try {
        await ensureDashboardClient();
        const query = authorizeQuery(req);
        const client = await findActiveClient(query.client_id);
        if (!client) return res.status(400).send("Unknown or revoked client");
        try {
            assertRedirectUri(client, query.redirect_uri);
        } catch (err) {
            return res.status(400).send(err.message);
        }
        const ssoUserId = readSsoUserId(req.cookies?.[SSO_COOKIE_NAME]);
        if (ssoUserId) {
            const user = await User.findById(ssoUserId).select("-password");
            if (user) return completeAuthorize(req, res, user, query);
        }
        res.type("html").send(authorizePage({ client, query }));
    } catch (error) {
        console.error("oauth authorize get", error);
        res.status(500).send("Authorization server error");
    }
});

oauthRouter.post("/authorize", async (req, res) => {
    try {
        const query = authorizeQuery(req);
        const client = await findActiveClient(query.client_id);
        if (!client) return res.status(400).send("Unknown or revoked client");
        try {
            const { user } = await authenticatePassword(query.email, query.password);
            return completeAuthorize(req, res, user, query);
        } catch (err) {
            return res.type("html").send(authorizePage({ error: err.message || "Invalid credentials", client, query }));
        }
    } catch (error) {
        console.error("oauth authorize post", error);
        res.status(500).send("Authorization server error");
    }
});

function basicClientAuth(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Basic ")) return {};
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep === -1) return {};
    return { client_id: decoded.slice(0, sep), client_secret: decoded.slice(sep + 1) };
}

function clientAuthFromRequest(req) {
    const body = req.body || {};
    const query = req.query || {};
    const basic = basicClientAuth(req);
    return {
        ...body,
        client_id: body.client_id || query.client_id || basic.client_id,
        client_secret: body.client_secret || basic.client_secret,
    };
}

oauthRouter.post("/token", async (req, res) => {
    try {
        const params = clientAuthFromRequest(req);
        const grant = params.grant_type;
        if (grant === "authorization_code") {
            const tokens = await exchangeAuthorizationCode(params);
            const client = await findActiveClient(params.client_id);
            if (client?.isFirstParty && tokens.refresh_token) {
                setRefreshCookie(res, tokens.refresh_token, { maxAge: 30 * 24 * 60 * 60 * 1000 });
            }
            return res.status(200).json({
                token_type: tokens.token_type,
                access_token: tokens.access_token,
                expires_in: tokens.expires_in,
                scope: tokens.scope,
                ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
            });
        }
        if (grant === "refresh_token") {
            const tokens = await rotateRefreshToken({
                refreshToken: params.refresh_token || req.cookies?.[REFRESH_COOKIE_NAME],
                clientId: params.client_id,
                clientSecret: params.client_secret,
            });
            const usedCookie = !params.refresh_token && Boolean(req.cookies?.[REFRESH_COOKIE_NAME]);
            const client = await findActiveClient(params.client_id || (usedCookie ? DASHBOARD_CLIENT_ID : null));
            if (client?.isFirstParty && tokens.refresh_token) {
                setRefreshCookie(res, tokens.refresh_token, { maxAge: 30 * 24 * 60 * 60 * 1000 });
            }
            return res.status(200).json({
                token_type: tokens.token_type,
                access_token: tokens.access_token,
                expires_in: tokens.expires_in,
                scope: tokens.scope,
                refresh_token: tokens.refresh_token,
            });
        }
        return oauthJsonError(res, new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token"));
    } catch (err) {
        if (err instanceof OAuthError) return oauthJsonError(res, err);
        console.error("oauth token", err);
        return oauthJsonError(res, new OAuthError("server_error", "Token endpoint failed", 500));
    }
});

oauthRouter.post("/revoke", async (req, res) => {
    try {
        const params = clientAuthFromRequest(req);
        await revokeToken({
            token: params.token,
            tokenTypeHint: params.token_type_hint,
            clientId: params.client_id,
            clientSecret: params.client_secret,
        });
        if (params.token_type_hint !== "access_token") clearRefreshCookie(res);
        return res.status(200).json({ revoked: true });
    } catch (error) {
        console.error("oauth revoke", error);
        return res.status(200).json({ revoked: true });
    }
});

oauthRouter.get("/userinfo", async (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const { success, message, data } = await verifyAccessJwt(token);
    if (!success) return res.status(401).json({ error: "invalid_token", error_description: message });
    const user = await User.findById(data.decoded.id).select("name email business");
    if (!user) return res.status(401).json({ error: "invalid_token", error_description: "User not found" });
    return res.status(200).json({
        sub: String(user._id),
        email: user.email,
        name: user.name,
        business: user.business,
    });
});

async function corsOriginAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const clientId = clientAuthFromRequest(req).client_id;
    if (clientId) {
        const client = await findActiveClient(clientId);
        if (client) return originAllowedForClient(client, origin);
    }
    return originAllowed(origin);
}

export function oauthCors(req, res, next) {
    corsOriginAllowed(req)
        .then((allowed) => {
            cors({
                origin: allowed ? (req.headers.origin || true) : false,
                methods: ["GET", "POST", "OPTIONS"],
                allowedHeaders: ["Content-Type", "Authorization"],
                credentials: true,
                optionsSuccessStatus: 200,
            })(req, res, next);
        })
        .catch(next);
}
