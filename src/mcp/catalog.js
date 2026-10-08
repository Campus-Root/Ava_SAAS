/** Agent-facing REST operations. MCP tools and the Avakado provider tool catalog both come from this list. */

const page = { type: 'integer', description: 'Page number, starting at 1.' };
const limit = { type: 'integer', description: 'Maximum number of records to return.' };
const from = { type: 'string', description: 'Inclusive createdAt lower bound, as an ISO date string.' };
const to = { type: 'string', description: 'Inclusive createdAt upper bound, as an ISO date string.' };

export const TOOL_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        data: { description: 'Provider or platform payload.' },
        billing: { type: 'object', description: 'Usage converted to dollars and credits, when this call is billed.' },
        metaData: { type: 'object', description: 'Pagination totals when the route is a list.' },
    },
};

export const TOOL_ERROR_SCHEMA = {
    type: 'object',
    required: ['success', 'message'],
    properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
    },
};

export const AVAKADO_TOOLS = [
    {
        name: 'jev',
        title: 'avakado.jev.systemone',
        description: 'Ask Jev one or more typed questions about a state. The signed-in business is billed from the returned token usage.',
        method: 'POST',
        path: '/v1/jev',
        category: 'AI',
        feature: 'Jev',
        idempotency: true,
        body: ['state', 'questions', 'model'],
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
        name: 'openai_chat',
        title: 'avakado.openai.chat',
        description: 'Create an OpenAI chat completion. The signed-in business is billed from the returned token usage. Streaming is not available on this route.',
        method: 'POST',
        path: '/v1/openai',
        category: 'AI',
        feature: 'OpenAI',
        idempotency: true,
        body: ['model', 'messages', 'temperature', 'max_completion_tokens', 'tools', 'tool_choice', 'response_format'],
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
    {
        name: 'list_leads',
        title: 'avakado.leads.list',
        description: 'List leads for the signed-in business. Filter by name, status, or a comma-separated tag list.',
        method: 'GET',
        path: '/lead',
        category: 'Platform',
        feature: 'Leads',
        query: ['page', 'limit', 'search', 'status', 'tags'],
        input: {
            type: 'object',
            additionalProperties: false,
            properties: {
                page,
                limit,
                search: { type: 'string', description: 'Case-insensitive match on the lead name.' },
                status: { type: 'string', description: 'Exact lead status.' },
                tags: { type: 'string', description: 'Comma-separated tags. A lead matches when it has any of them.' },
            },
        },
    },
    {
        name: 'get_lead',
        title: 'avakado.leads.get',
        description: 'Fetch one lead by id.',
        method: 'GET',
        path: '/lead/:id',
        category: 'Platform',
        feature: 'Leads',
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Lead id.' },
            },
        },
    },
    {
        name: 'create_lead',
        title: 'avakado.leads.create',
        description: 'Create a lead on the signed-in business.',
        method: 'POST',
        path: '/lead',
        category: 'Platform',
        feature: 'Leads',
        body: ['name', 'template', 'contactDetails', 'source', 'tags', 'status', 'notes', 'data'],
        input: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: { type: 'string' },
                template: { description: 'Lead template id or template payload accepted by the lead model.' },
                contactDetails: { type: 'object', description: 'Phone, email, and messaging handles.' },
                source: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                status: { type: 'string' },
                notes: { description: 'Notes stored on the lead.' },
                data: { type: 'object', description: 'Extra lead fields.' },
            },
        },
    },
    {
        name: 'update_lead',
        title: 'avakado.leads.update',
        description: 'Update a lead status and notes.',
        method: 'PATCH',
        path: '/lead/:id',
        category: 'Platform',
        feature: 'Leads',
        body: ['status', 'notes'],
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Lead id.' },
                status: { type: 'string' },
                notes: { description: 'Replacement notes.' },
            },
        },
    },
    {
        name: 'contact_lead',
        title: 'avakado.leads.contact',
        description: 'Send a WhatsApp, Telegram, or Instagram message, or start an Exotel call, to a lead. File uploads stay on the REST route as multipart form data; this tool sends JSON messages.',
        method: 'POST',
        path: '/lead/contact',
        category: 'Platform',
        feature: 'Leads',
        body: ['id', 'channelId', 'conversationId', 'action', 'message', 'caption'],
        input: {
            type: 'object',
            required: ['id', 'channelId'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Lead id.' },
                channelId: { type: 'string', description: 'Channel used to reach the lead.' },
                conversationId: { type: 'string', description: 'Existing conversation. Omit to open one.' },
                action: { type: 'string', description: 'sendMessage or sendMedia. sendMedia requires the REST multipart upload.' },
                message: { type: 'object', description: 'Outbound message. WhatsApp sendMessage requires message.type and message.data.' },
                caption: { type: 'string' },
            },
        },
    },
    {
        name: 'list_conversations',
        title: 'avakado.conversations.list',
        description: 'List conversations for the signed-in business.',
        method: 'GET',
        path: '/conversation',
        category: 'Platform',
        feature: 'Conversations',
        query: ['page', 'limit', 'status', 'priority', 'id', 'leadId', 'leadIds', 'channelId', 'channelIds', 'agentIds', 'campaignIds', 'from', 'to'],
        input: {
            type: 'object',
            additionalProperties: false,
            properties: {
                page,
                limit,
                status: { type: 'string' },
                priority: { type: 'string' },
                id: { type: 'string', description: 'One conversation id.' },
                leadId: { type: 'string' },
                leadIds: { type: 'string', description: 'Comma-separated lead ids.' },
                channelId: { type: 'string' },
                channelIds: { type: 'string', description: 'Comma-separated channel ids.' },
                agentIds: { type: 'string', description: 'Comma-separated agent ids.' },
                campaignIds: { type: 'string', description: 'Comma-separated campaign ids.' },
                from,
                to,
            },
        },
    },
    {
        name: 'get_conversation',
        title: 'avakado.conversations.get',
        description: 'Fetch messages and call sessions for one conversation in a createdAt window.',
        method: 'GET',
        path: '/conversation/:id',
        category: 'Platform',
        feature: 'Conversations',
        query: ['from', 'to'],
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Conversation id.' },
                from,
                to,
            },
        },
    },
    {
        name: 'list_messages',
        title: 'avakado.conversations.messages',
        description: 'List messages in a conversation, newest first.',
        method: 'GET',
        path: '/conversation/:id/messages',
        category: 'Platform',
        feature: 'Conversations',
        query: ['page', 'limit', 'from', 'to'],
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Conversation id.' },
                page,
                limit,
                from,
                to,
            },
        },
    },
    {
        name: 'list_call_sessions',
        title: 'avakado.conversations.callSessions',
        description: 'List call sessions in a conversation, newest first.',
        method: 'GET',
        path: '/conversation/:id/call-sessions',
        category: 'Platform',
        feature: 'Conversations',
        query: ['page', 'limit', 'from', 'to', 'direction', 'externalCallSessionId'],
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Conversation id.' },
                page,
                limit,
                from,
                to,
                direction: { type: 'string', description: 'Comma-separated call directions.' },
                externalCallSessionId: { type: 'string' },
            },
        },
    },
    {
        name: 'handoff_conversation',
        title: 'avakado.conversations.handoff',
        description: 'Hand a conversation to a human and notify the conversation room.',
        method: 'PATCH',
        path: '/conversation/human-handoff/:id',
        category: 'Platform',
        feature: 'Conversations',
        body: ['handoffReason', 'handoffUrgency', 'assignedTo'],
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Conversation id.' },
                handoffReason: { type: 'string', description: 'Why the conversation needs a person. Defaults to an explicit request for a human.' },
                handoffUrgency: { type: 'string', description: 'Defaults to normal.' },
                assignedTo: { type: 'string', description: 'Defaults to human.' },
            },
        },
    },
    {
        name: 'list_campaigns',
        title: 'avakado.campaigns.list',
        description: 'List campaigns for the signed-in business.',
        method: 'GET',
        path: '/campaign',
        category: 'Platform',
        feature: 'Campaigns',
        query: ['page', 'limit', 'name', 'status', 'channelIds', 'leadIds'],
        input: {
            type: 'object',
            additionalProperties: false,
            properties: {
                page,
                limit,
                name: { type: 'string', description: 'Case-insensitive match on the campaign name.' },
                status: { type: 'string' },
                channelIds: { type: 'string', description: 'Comma-separated channel ids.' },
                leadIds: { type: 'string', description: 'Comma-separated lead ids.' },
            },
        },
    },
    {
        name: 'get_campaign',
        title: 'avakado.campaigns.get',
        description: 'Fetch one campaign owned by the signed-in business.',
        method: 'GET',
        path: '/campaign/:id',
        category: 'Platform',
        feature: 'Campaigns',
        input: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {
                id: { type: 'string', description: 'Campaign id.' },
            },
        },
    },
    {
        name: 'create_campaign',
        title: 'avakado.campaigns.create',
        description: 'Schedule a campaign on a WhatsApp, Telegram, Instagram, or Exotel channel. WhatsApp requires config.runtime.templateName and languageCode. The campaign is saved on the signed-in business.',
        method: 'POST',
        path: '/campaign',
        category: 'Platform',
        feature: 'Campaigns',
        body: ['name', 'channelId', 'leadIds', 'config', 'scheduledAt'],
        input: {
            type: 'object',
            required: ['name', 'channelId', 'leadIds'],
            additionalProperties: false,
            properties: {
                name: { type: 'string' },
                channelId: { type: 'string' },
                leadIds: { type: 'array', items: { type: 'string' }, description: 'Leads to include.' },
                config: { type: 'object', description: 'Channel runtime config, including retries and template fields.' },
                scheduledAt: { type: 'string', description: 'ISO time to run. Defaults to about ten minutes from now.' },
            },
        },
    },
];

export function restPathTemplate(path) {
    if (!path.includes(':')) return path;
    const expression = path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => '${input.' + key + '}');
    return '{{`' + expression + '`}}';
}

export function toApiDefinition(spec, base) {
    const params = {};
    for (const key of spec.query || []) params[key] = `{{input.${key}}}`;
    const body = {};
    for (const key of spec.body || []) body[key] = `{{input.${key}}}`;
    const headers = {
        Authorization: '{{`Bearer ${auth.credentials.accessToken}`}}',
        'Content-Type': 'application/json',
    };
    if (spec.idempotency) headers['Idempotency-Key'] = '{{input.idempotencyKey}}';
    return {
        title: spec.title,
        description: spec.description,
        version: 'v1',
        schemas: {
            auth: 'oauth2',
            input: spec.input,
            output: TOOL_OUTPUT_SCHEMA,
            error: TOOL_ERROR_SCHEMA,
        },
        requestTemplate: {
            method: spec.method,
            url: { base, path: restPathTemplate(spec.path), params },
            headers,
            body,
        },
        requiredScopes: [],
        metadata: { category: spec.category, feature: spec.feature, AVA_Version: 1 },
    };
}

export function toolHttpRequest(tool, args = {}) {
    const path = tool.path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => encodeURIComponent(String(args[key] ?? '')));
    const query = {};
    for (const key of tool.query || []) {
        if (args[key] != null && args[key] !== '') query[key] = args[key];
    }
    const body = {};
    let hasBody = false;
    for (const key of tool.body || []) {
        if (args[key] !== undefined) {
            body[key] = args[key];
            hasBody = true;
        }
    }
    const headers = {};
    if (tool.idempotency && args.idempotencyKey) headers['Idempotency-Key'] = String(args.idempotencyKey).slice(0, 200);
    return { method: tool.method, path, query, body: hasBody ? body : undefined, headers };
}
