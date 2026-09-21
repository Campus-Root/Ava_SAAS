export function contactUsValidation({ name, contactDetails, purpose } = {}) {
    if (!name || !contactDetails || !purpose) {
        return { ok: false, status: 400, error: 'Missing required fields' };
    }
    if (!contactDetails.email && !contactDetails.phone) {
        return { ok: false, status: 400, error: 'At least one contact detail (email or phone) is required' };
    }
    return { ok: true };
}

export function ephemeralTokenArgsOk({ id, model, voice, provider } = {}) {
    if (id) return true;
    return Boolean(model && voice && provider);
}

export const PUBLIC_GRAPHQL_OPS = [
    'fetchPublicPlans',
    'ephemeralToken',
    'startDemo',
    'talkToAi',
];
