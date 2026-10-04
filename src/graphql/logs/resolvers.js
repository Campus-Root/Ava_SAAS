import mongoose from 'mongoose';
import { GraphQLError } from 'graphql';
import { Log, UsageLog, WorkflowLogs } from '@avakado.ai/schemas';
import { DateTime } from '../scalars/DateTime.js';
import { JSONScalar } from '../scalars/JSON.js';

const MAX_LIMIT = 100;
const SEARCH_FIELDS = {
    logs: ['message', 'event', 'requestId', 'service'],
    usage: ['note', 'idempotencyKey', 'source.type'],
    workflows: ['name', 'summary', 'trigger', 'executionId', 'eventId'],
};

const clampLimit = (limit = 25) => Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 25));
const clampPage = (page = 1) => Math.max(1, Number(page) || 1);

const cleanText = (value) => {
    if (value == null) return undefined;
    const text = String(value).trim().slice(0, 80);
    return text || undefined;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectId = (value) => {
    const text = value?._id ? String(value._id) : String(value ?? '');
    if (!/^[a-fA-F0-9]{24}$/.test(text)) {
        throw new GraphQLError('Invalid business id', { extensions: { code: 'BAD_USER_INPUT' } });
    }
    return new mongoose.Types.ObjectId(text);
};

const businessClause = (user, businessId) => {
    const platform = user.role === 'superAdmin' || user.scopes?.includes('super:all');
    if (platform) return businessId ? { business: toObjectId(businessId) } : {};
    if (!user.business) throw new GraphQLError('Business access required', { extensions: { code: 'FORBIDDEN' } });
    return { business: toObjectId(user.business) };
};

const textClause = (search, fields) => {
    const text = cleanText(search);
    if (!text) return null;
    const pattern = escapeRegex(text);
    return { $or: fields.map((field) => ({ [field]: { $regex: pattern, $options: 'i' } })) };
};

const mergeFilter = (...parts) => Object.assign({}, ...parts.filter(Boolean));

const sinceClause = (since) => {
    if (!since) return null;
    const date = since instanceof Date ? since : new Date(since);
    if (Number.isNaN(date.getTime())) throw new GraphQLError('Invalid since', { extensions: { code: 'BAD_USER_INPUT' } });
    return { createdAt: { $gte: date } };
};

const party = (value) => {
    if (!value) return null;
    if (typeof value === 'object' && value._id && ('name' in value || value.name === null)) {
        return { _id: value._id, name: value.name ?? null };
    }
    return { _id: value, name: null };
};

const metaDataFor = (page, limit, totalDocuments) => ({
    page,
    limit,
    totalPages: totalDocuments === 0 ? 0 : Math.ceil(totalDocuments / limit),
    totalDocuments,
});

const pageQuery = async (model, filter, page, limit) => {
    const [data, totalDocuments] = await Promise.all([
        model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('business', 'name').lean(),
        model.countDocuments(filter),
    ]);
    return { data, totalDocuments };
};

const constrainedCount = (model, filter, extra) => {
    const contradicts = Object.entries(extra).some(([key, value]) => filter[key] != null && String(filter[key]) !== String(value));
    if (contradicts) return 0;
    return model.countDocuments({ ...filter, ...extra });
};

const creditTotals = async (filter) => {
    const [row] = await UsageLog.aggregate([
        { $match: filter },
        {
            $group: {
                _id: null,
                creditsDebited: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$credits', 0] } },
                creditsCredited: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$credits', 0] } },
            },
        },
    ]);
    return {
        creditsDebited: row?.creditsDebited || 0,
        creditsCredited: row?.creditsCredited || 0,
    };
};

export const logResolvers = {
    DateTime,
    JSON: JSONScalar,
    Query: {
        async fetchLogView(_, args, context) {
            const limit = clampLimit(args.limit);
            const page = clampPage(args.page);
            const scoped = businessClause(context.user, args.business);
            const service = cleanText(args.service);
            const since = sinceClause(args.since);

            const logFilter = mergeFilter(
                scoped,
                since,
                args.level && { level: args.level },
                args.category && { category: args.category },
                args.logStatus && { status: args.logStatus },
                args.environment && { environment: args.environment },
                service && { service: { $regex: escapeRegex(service), $options: 'i' } },
                textClause(args.search, SEARCH_FIELDS.logs),
            );
            const usageFilter = mergeFilter(
                scoped,
                since,
                args.usageDirection && { direction: args.usageDirection },
                args.usageStatus && { status: args.usageStatus },
                textClause(args.search, SEARCH_FIELDS.usage),
            );
            const workflowFilter = mergeFilter(
                scoped,
                since,
                args.workflowStatus && { status: args.workflowStatus },
                textClause(args.search, SEARCH_FIELDS.workflows),
            );

            const [logs, usageLogs, workflowLogs, errors, failedLogs, failedWorkflows, runningWorkflows, credits] = await Promise.all([
                pageQuery(Log, logFilter, page, limit),
                pageQuery(UsageLog, usageFilter, page, limit),
                pageQuery(WorkflowLogs, workflowFilter, page, limit),
                constrainedCount(Log, logFilter, { level: 'error' }),
                constrainedCount(Log, logFilter, { status: 'FAILURE' }),
                constrainedCount(WorkflowLogs, workflowFilter, { status: 'failed' }),
                constrainedCount(WorkflowLogs, workflowFilter, { status: 'running' }),
                creditTotals(usageFilter),
            ]);

            return {
                fetchedAt: new Date(),
                summary: {
                    logs: logs.totalDocuments,
                    usageLogs: usageLogs.totalDocuments,
                    workflowLogs: workflowLogs.totalDocuments,
                    errors,
                    failedLogs,
                    failedWorkflows,
                    runningWorkflows,
                    ...credits,
                },
                logs: {
                    data: logs.data.map((doc) => ({ ...doc, business: party(doc.business) })),
                    metaData: metaDataFor(page, limit, logs.totalDocuments),
                },
                usageLogs: {
                    data: usageLogs.data.map((doc) => ({
                        ...doc,
                        business: party(doc.business),
                        source: doc.source?.type || doc.source?.id ? { type: doc.source.type, id: doc.source.id } : null,
                    })),
                    metaData: metaDataFor(page, limit, usageLogs.totalDocuments),
                },
                workflowLogs: {
                    data: workflowLogs.data.map((doc) => ({
                        ...doc,
                        business: party(doc.business),
                        steps: doc.steps || [],
                    })),
                    metaData: metaDataFor(page, limit, workflowLogs.totalDocuments),
                },
            };
        },
    },
};
