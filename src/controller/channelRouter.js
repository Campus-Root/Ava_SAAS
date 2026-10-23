
import { Router } from 'express';
import { Channel } from '@avakado.ai/schemas';
import { authMiddleware } from '../middleware/auth.js';

export const channelRoutes = Router();

channelRoutes.get('/', authMiddleware, async (req, res) => {
    try {
        const { business } = req.user;
        const { limit = 10, page = 1, id, provider, apiAuthenticator, status, type, sort = { updatedAt: -1 } } = req.query;
        const filter = { business };
        if (id) filter._id = id;
        if (status) filter.status = status;
        if (provider) filter.provider = provider;
        if (apiAuthenticator) filter.apiAuthenticator = apiAuthenticator;
        if (type) filter.type = type;
        const channels = await Channel.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
        const total = await Channel.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Channels fetched successfully', data: channels, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch channels', error: error.message });
    }
});