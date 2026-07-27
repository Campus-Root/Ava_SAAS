import BaseOAuthProvider from "../services/ExternalAuthenticationServices/base.js";
import OauthCalendly from "../services/ExternalAuthenticationServices/calendly.js";
import OauthExotel from "../services/ExternalAuthenticationServices/exotel.js";
import OauthGoogle from "../services/ExternalAuthenticationServices/google.js";
import OauthInstagram from "../services/ExternalAuthenticationServices/instagram.js";
import OauthMicrosoft from "../services/ExternalAuthenticationServices/microsoft.js";
import OauthTataTele from "../services/ExternalAuthenticationServices/tatatele.js";
import OauthTelegram from "../services/ExternalAuthenticationServices/telegram.js";
import OauthTwilio from "../services/ExternalAuthenticationServices/twilio.js";
import OauthWhatsApp from "../services/ExternalAuthenticationServices/whatsapp.js";
import OauthAvakado from "../services/ExternalAuthenticationServices/avakado.js";
import { Channel } from "../models/Channels.js";
import { parsePhoneNumber } from 'libphonenumber-js';




export function providerSupportsRefresh(provider) {
    const prototype = typeof provider === "function"
        ? provider.prototype
        : Object.getPrototypeOf(provider);
    return prototype.refreshToken !== BaseOAuthProvider.prototype.refreshToken;
}

/** authType discriminator for ApiAuthenticators when persisting getTokens() results */
export const PROVIDER_AUTH_TYPE = {
    Whatsapp: 'oauth2',
    Instagram: 'oauth2',
    Gmail: 'oauth2',
    'Google Drive': 'oauth2',
    'Google Forms': 'oauth2',
    'Google Calendar': 'oauth2',
    'Google Sheets': 'oauth2',
    'Microsoft Excel': 'oauth2',
    Calendly: 'oauth2',
    Twilio: 'basic',
    Telegram: 'apiKey',
    Exotel: 'apiKey',
    'Tata Tele': 'apiKey',
};

export function buildAuthenticatorFromTokens(providerName, tokensRes) {
    if (!tokensRes?.success) {
        throw new Error(tokensRes?.error?.message || 'Token exchange failed');
    }
    const authType = PROVIDER_AUTH_TYPE[providerName];
    if (!authType) throw new Error(`Unknown auth type for provider: ${providerName}`);
    return {
        authType,
        credentials: tokensRes.data,
        config: tokensRes.config ?? {},
        scope: tokensRes.scope ?? [],
        accountDetails: tokensRes.accountDetails ?? null,
    };
}




export const PROVIDER_MAP = {
    "Whatsapp": new OauthWhatsApp(),
    "Instagram": new OauthInstagram(),
    "Twilio": new OauthTwilio(),
    "Gmail": new OauthGoogle(),
    "Google Drive": new OauthGoogle(),
    "Google Forms": new OauthGoogle(),
    "Google Calendar": new OauthGoogle(),
    "Google Sheets": new OauthGoogle(),
    "Microsoft Excel": new OauthMicrosoft(),
    "Calendly": new OauthCalendly(),
    "Telegram": new OauthTelegram(),
    'Avakado.ai': new OauthAvakado(),
    "Exotel": new OauthExotel(),
    "Tata Tele": new OauthTataTele(),
};

export const normalizePhoneNumber = (rawNumber, defaultCountry = 'IN') => {
    if (!rawNumber) return null;

    try {
        const phoneNumber = parsePhoneNumber(rawNumber, defaultCountry);
        if (phoneNumber && phoneNumber.isValid()) {
            return {
                number: phoneNumber.number,// returns E.164, e.g. "+919959964639"
                countryCallingCode: phoneNumber.countryCallingCode,
                country: phoneNumber.country,
                nationalNumber: phoneNumber.nationalNumber
            };
        }
        return null;
    } catch (err) {
        console.warn(`Failed to parse phone number "${rawNumber}":`, err.message);
        return null;
    }
}