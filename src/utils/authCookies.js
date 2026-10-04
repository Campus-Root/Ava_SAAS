export const REFRESH_COOKIE_NAME = 'AVA_RT';
export const SSO_COOKIE_NAME = 'AVA_SSO';
export const RENEWED_ACCESS_HEADER = 'X-Access-Token';
export const RENEWED_ACCESS_EXPIRES_HEADER = 'X-Access-Token-Expires-In';

export const refreshCookieOptions = {
    secure: true,
    httpOnly: true,
    sameSite: 'None',
    domain: '.avakado.ai',
};

export function sendRenewedAccessToken(res, { accessToken, expiresIn }) {
    if (!res) return;
    res.setHeader(RENEWED_ACCESS_HEADER, accessToken);
    res.setHeader(RENEWED_ACCESS_EXPIRES_HEADER, String(expiresIn));
}

export function setRefreshCookie(res, refreshToken, extras = {}) {
    if (!res) return;
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, { ...refreshCookieOptions, ...extras });
}

export function clearRefreshCookie(res) {
    if (!res) return;
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
}

export function setSsoCookie(res, token, extras = {}) {
    if (!res) return;
    res.cookie(SSO_COOKIE_NAME, token, { ...refreshCookieOptions, ...extras });
}

export function clearSsoCookie(res) {
    if (!res) return;
    res.clearCookie(SSO_COOKIE_NAME, refreshCookieOptions);
}
