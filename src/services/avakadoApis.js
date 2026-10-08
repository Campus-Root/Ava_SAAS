import axios from 'axios';
import { Api, Providers } from '@avakado.ai/schemas';
import { createProviderMap } from '@avakado.ai/providers';
import { AVAKADO_TOOLS, toApiDefinition } from '../mcp/catalog.js';

const AVAKADO_API_BASE = process.env.AVAKADO_API_BASE || 'https://app.avakado.ai';

const providers = createProviderMap(process.env);

export async function ensureAvakadoApis() {
    const provider = await Providers.findOne({ name: /^avakado/i });
    if (!provider) throw new Error('Avakado provider was not found');
    const saved = [];
    for (const spec of AVAKADO_TOOLS) {
        const definition = toApiDefinition(spec, AVAKADO_API_BASE);
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
        const mod = await import('@avakado.ai/providers/jev.js');
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
