import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AVAKADO_TOOLS } from './catalog.js';
import { invokeTool } from './dispatch.js';

function fieldSchema(prop) {
    const types = Array.isArray(prop?.type) ? prop.type : prop?.type ? [prop.type] : [];
    let schema;
    if (types.length > 1) schema = z.union(types.map((type) => fieldSchema({ ...prop, type })));
    else if (types.length === 0) schema = z.any();
    else {
        switch (types[0]) {
            case 'string':
                schema = z.string();
                break;
            case 'number':
                schema = z.number();
                break;
            case 'integer':
                schema = z.number().int();
                break;
            case 'boolean':
                schema = z.boolean();
                break;
            case 'array':
                schema = z.array(prop.items ? fieldSchema(prop.items) : z.any());
                break;
            case 'object':
                schema = prop.properties ? z.object(inputShape(prop)).strict() : z.record(z.any());
                break;
            default:
                schema = z.any();
        }
    }
    if (prop?.description) schema = schema.describe(prop.description);
    return schema;
}

export function inputShape(schema) {
    const shape = {};
    const required = new Set(schema?.required || []);
    for (const [key, prop] of Object.entries(schema?.properties || {})) {
        let field = fieldSchema(prop);
        if (!required.has(key)) field = field.optional();
        shape[key] = field;
    }
    return shape;
}

export function createAvakadoMcpServer() {
    const server = new McpServer({
        name: 'avakado',
        version: '1.0.0',
        title: 'AVAKADO',
        description: 'Avakado platform tools for leads, conversations, campaigns, Jev, and OpenAI.',
        websiteUrl: 'https://app.avakado.ai',
    }, {
        instructions: 'Each tool calls the same authenticated Avakado REST API as the signed-in business. Connect with Authorization: Bearer <access token>. Jev and OpenAI debit credits from that business. File uploads for lead media stay on POST /lead/contact as multipart form data.',
    });

    for (const tool of AVAKADO_TOOLS) {
        server.registerTool(tool.name, {
            title: tool.title,
            description: tool.description,
            inputSchema: inputShape(tool.input),
            annotations: {
                readOnlyHint: tool.method === 'GET',
                destructiveHint: false,
                idempotentHint: tool.method === 'GET' || tool.method === 'PATCH',
                openWorldHint: false,
            },
        }, async (args) => {
            const result = await invokeTool(tool, args);
            return {
                content: [{ type: 'text', text: JSON.stringify(result.body) }],
                isError: result.status >= 400,
            };
        });
    }

    return server;
}
