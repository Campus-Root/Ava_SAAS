import { createProviderMap, providerSupportsRefresh, PROVIDER_AUTH_TYPE, buildAuthenticatorFromTokens } from "@avakado.ai/providers";
import { parsePhoneNumber } from 'libphonenumber-js';

export { providerSupportsRefresh, PROVIDER_AUTH_TYPE, buildAuthenticatorFromTokens };
export const PROVIDER_MAP = createProviderMap(process.env);

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
