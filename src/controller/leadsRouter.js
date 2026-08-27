import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { Lead } from '../models/Leads.js';
export const leadRoutes = Router();
leadRoutes.get('/', authMiddleware, async (req, res) => {
    try {
        const { businessId } = req.user;
        const { page = 1, limit = 10 } = req.query;
        let filter = { business: businessId };
        if (req.query.search) {
            filter.name = { $regex: req.query.search, $options: 'i' };
        }
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.tags) {
            filter.tags = { $in: req.query.tags.split(',') };
        }
        const leads = await Lead.find(filter).skip((page - 1) * limit).limit(limit);
        const total = await Lead.countDocuments(filter);
        res.status(200).json({ success: true, message: 'Leads fetched successfully', data: leads, metaData: { total, page, limit } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch leads', error: error.message });
    }

});
leadRoutes.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const lead = await Lead.findById(id);
        if (!lead) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        res.status(200).json({ success: true, message: 'Lead fetched successfully', data: lead });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to fetch lead', error: error.message });
    }
});
leadRoutes.post('/', authMiddleware, async (req, res) => {
    try {
        const { businessId } = req.user;
        const { name, template, contactDetails, source, tags, status, notes, data } = req.body;
        const lead = await Lead.create({ business: businessId, name, template, contactDetails, source, tags, status, notes, data });
        res.status(200).json({ success: true, message: 'Lead created successfully', data: lead });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to create lead', error: error.message });
    }
});
leadRoutes.patch('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        const lead = await Lead.findByIdAndUpdate(id, { status, notes }, { new: true, runValidators: true });
        if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
        res.status(200).json({ success: true, message: 'Lead updated successfully', data: lead });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to update lead', error: error.message });
    }
});
// leadRoutes.delete('/:id', authMiddleware, async (req, res) => {
//     res.status(200).json({ message: 'Hello World' });
// });