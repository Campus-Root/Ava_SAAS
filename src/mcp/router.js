import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateBearer } from '../middleware/auth.js';
import { createAvakadoMcpServer } from './server.js';
import { mcpCallContext } from './dispatch.js';

export const mcpRouter = Router();

function unauthorized(res, message) {
    res.set('WWW-Authenticate', 'Bearer realm="avakado"');
    return res.status(401).json({ success: false, message });
}

async function handleMcp(req, res) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return unauthorized(res, 'Access Token Missing');

    const session = await authenticateBearer(req, res, token);
    if (session.error) return unauthorized(res, session.error);

    const server = createAvakadoMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    res.on('close', () => {
        transport.close().catch(() => { });
    });

    try {
        const port = req.socket?.localPort || Number(process.env.PORT);
        await mcpCallContext.run({
            authorization: `Bearer ${session.accessToken || token}`,
            port,
        }, async () => {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        });
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

mcpRouter.post('/', handleMcp);
mcpRouter.get('/', handleMcp);
mcpRouter.delete('/', handleMcp);
