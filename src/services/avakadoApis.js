import axios from 'axios';
import { Api, Providers } from '@avakado.ai/schemas';
import { createProviderMap } from '@avakado.ai/providers';

const AVAKADO_API_BASE = 'https://app.avakado.ai';

const providers = createProviderMap(process.env);

export const AVAKADO_PROVIDER_APIS = [
    {
        title: 'avakado.jev.systemone',
        description: 'Ask Jev one or more typed questions about a state. The signed-in business is billed from the returned token usage.',
        path: '/v1/jev',
        feature: 'Jev',
        body: {
            state: '{{input.state}}',
            questions: '{{input.questions}}',
            model: '{{input.model}}',
        },
        input: {
            type: 'object',
            required: ['state', 'questions'],
            additionalProperties: false,
            properties: {
                state: { type: ['string', 'object', 'array'], description: 'The situation Jev should judge.' },
                questions: { type: 'object', description: 'Map of question id to a noul, choice, or score question.' },
                model: { type: 'string', description: 'Jev model. Defaults to jev-latest.' },
                idempotencyKey: { type: 'string', description: 'Reuse this key so a retry is not billed twice.' },
            },
        },
    },
    {
        title: 'avakado.openai.chat',
        description: 'Create an OpenAI chat completion. The signed-in business is billed from the returned token usage.',
        path: '/v1/openai',
        feature: 'OpenAI',
        body: {
            model: '{{input.model}}',
            messages: '{{input.messages}}',
            temperature: '{{input.temperature}}',
            max_completion_tokens: '{{input.max_completion_tokens}}',
            tools: '{{input.tools}}',
            tool_choice: '{{input.tool_choice}}',
            response_format: '{{input.response_format}}',
        },
        input: {
            type: 'object',
            required: ['model', 'messages'],
            additionalProperties: false,
            properties: {
                model: { type: 'string', description: 'OpenAI model id, such as gpt-4.1-mini.' },
                messages: { type: 'array', description: 'Chat messages. Each item has a role and content.' },
                temperature: { type: 'number' },
                max_completion_tokens: { type: 'number' },
                tools: { type: 'array' },
                tool_choice: {},
                response_format: { type: 'object' },
                idempotencyKey: { type: 'string', description: 'Reuse this key so a retry is not billed twice.' },
            },
        },
    },
];

function apiDefinition(spec) {
    return {
        title: spec.title,
        description: spec.description,
        version: 'v1',
        schemas: {
            auth: 'oauth2',
            input: spec.input,
            output: {
                type: 'object',
                required: ['success', 'data', 'billing'],
                properties: {
                    success: { type: 'boolean' },
                    data: { type: 'object', description: 'Provider response.' },
                    billing: {
                        type: 'object',
                        description: 'Token usage converted to dollars and credits, and whether the debit was queued.',
                    },
                },
            },
            error: {
                type: 'object',
                required: ['success', 'message'],
                properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                },
            },
        },
        requestTemplate: {
            method: 'POST',
            url: { base: AVAKADO_API_BASE, path: spec.path, params: {} },
            headers: {
                Authorization: '{{`Bearer ${auth.credentials.accessToken}`}}',
                'Content-Type': 'application/json',
                'Idempotency-Key': '{{input.idempotencyKey}}',
            },
            body: spec.body,
        },
        requiredScopes: [],
        metadata: { category: 'AI', feature: spec.feature, AVA_Version: 1 },
    };
}

export async function ensureAvakadoApis() {
    const provider = await Providers.findOne({ name: /^avakado/i });
    if (!provider) throw new Error('Avakado provider was not found');
    const saved = [];
    for (const spec of AVAKADO_PROVIDER_APIS) {
        const definition = apiDefinition(spec);
        const api = await Api.findOneAndUpdate(
            { provider: provider._id, title: spec.title },
            { $set: definition },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        saved.push(api);
    }
    return saved;
}

export async function callJev({ state, questions, model } = {}) {
    if (providers.Jev?.systemOne) return providers.Jev.systemOne({ state, questions, model });
    try {
        const mod = await import('../../../avakado-shared/packages/providers/src/jev.js');
        const jev = new mod.default({
            apiKey: process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY,
            baseUrl: process.env.TYPESAFE_BASE_URL,
            model: process.env.TYPESAFE_DEFAULT_MODEL,
        });
        return jev.systemOne({ state, questions, model });
    } catch {
        return callJevHttp({ state, questions, model });
    }
}

async function callJevHttp({ state, questions, model }) {
    const apiKey = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY;
    if (!apiKey) return { success: false, error: { code: 'missing_apiKey', message: 'An apiKey string is required.', status: 400 } };
    const root = (process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai').replace(/\/+$/, '');
    try {
        const { data } = await axios.post(`${root}/v1/systemone`, {
            state,
            model: model || process.env.TYPESAFE_DEFAULT_MODEL || 'jev-latest',
            questions,
        }, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 10_000,
        });
        return { success: true, data };
    } catch (error) {
        const status = error?.response?.status || 502;
        const message = error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || 'Jev request failed';
        return { success: false, error: { message, status } };
    }
}
