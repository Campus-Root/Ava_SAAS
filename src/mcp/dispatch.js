import axios from 'axios';
import { AsyncLocalStorage } from 'node:async_hooks';
import { toolHttpRequest } from './catalog.js';

export const mcpCallContext = new AsyncLocalStorage();

export async function callPlatformApi({ method, path, query, body, headers }) {
    const ctx = mcpCallContext.getStore();
    if (!ctx?.authorization || !ctx.port) {
        return { status: 401, body: { success: false, message: 'Access Token Missing' } };
    }
    try {
        const response = await axios({
            method,
            url: `http://127.0.0.1:${ctx.port}${path}`,
            params: query,
            data: body,
            headers: {
                Authorization: ctx.authorization,
                Accept: 'application/json',
                ...headers,
            },
            validateStatus: () => true,
            timeout: 120_000,
        });
        return { status: response.status, body: response.data };
    } catch (error) {
        return { status: 502, body: { success: false, message: error.message || 'Failed to reach Avakado API' } };
    }
}

export function invokeTool(tool, args) {
    return callPlatformApi(toolHttpRequest(tool, args || {}));
}
