import { Lead } from '@avakado.ai/schemas';
import {
  buildDuplicateQuery,
  mergeContactDetails,
  findMatchedHandles,
  contactMatchClauses,
  indexLeadsByHandle,
  classifyBulkCreateRow,
} from '../../utils/leadDuplicateUtils.js';
import { assertUser } from '../progress/auth.js';
import { errorText, feed, progressSnapshot } from '../progress/events.js';

const VALIDATE_FIELD = 'validateBulkCreateLeadsProgress';
const CREATE_FIELD = 'bulkCreateLeadsProgress';
const CHUNK = 25;

function bulkValidateResult(dataList, wouldCreate, conflicts) {
  return {
    wouldCreate,
    conflicts,
    summary: {
      total: dataList.length,
      wouldCreate: wouldCreate.length,
      existingDuplicates: conflicts.filter((row) => row.reason === 'EXISTING_LEAD').length,
      withinBatchDuplicates: conflicts.filter((row) => row.reason === 'WITHIN_BATCH').length,
    },
  };
}

export async function* validateBulkCreateLeadsStream(_, { dataList }, context) {
  const user = assertUser(context, 'lead:import');
  const businessId = user.business;
  const rows = dataList || [];
  const total = rows.length;
  const wouldCreate = [];
  const conflicts = [];
  const seenInBatch = new Map();
  const handleToLead = new Map();
  let processed = 0;

  try {
    yield feed(VALIDATE_FIELD, {
      progress: progressSnapshot({ phase: 'started', processed: 0, total, message: 'Checking contacts' }),
    });

    for (let start = 0; start < rows.length; start += CHUNK) {
      const slice = rows.slice(start, start + CHUNK);
      const orClauses = slice.flatMap((input) => contactMatchClauses(input.contactDetails));
      const existingLeads = orClauses.length
        ? await Lead.find({ business: businessId, $or: orClauses }).lean()
        : [];
      for (const [key, lead] of indexLeadsByHandle(existingLeads)) {
        if (!handleToLead.has(key)) handleToLead.set(key, lead);
      }

      for (let offset = 0; offset < slice.length; offset += 1) {
        const index = start + offset;
        const classified = classifyBulkCreateRow(slice[offset], index, seenInBatch, handleToLead);
        if (classified.conflict) conflicts.push(classified.conflict);
        else wouldCreate.push(classified.row);
        processed += 1;
        yield feed(VALIDATE_FIELD, {
          progress: progressSnapshot({
            phase: 'progress',
            processed,
            total,
            index,
            ok: classified.outcome === 'WOULD_CREATE',
            message: classified.outcome === 'WOULD_CREATE' ? 'Ready to create' : classified.outcome,
          }),
          index,
          outcome: classified.outcome,
          row: classified.row || null,
          conflict: classified.conflict || null,
        });
      }
    }

    yield feed(VALIDATE_FIELD, {
      progress: progressSnapshot({
        phase: 'completed',
        processed: total,
        total,
        ok: true,
        message: 'Validation finished',
      }),
      result: bulkValidateResult(rows, wouldCreate, conflicts),
    });
  } catch (error) {
    console.error('validateBulkCreateLeadsProgress:', errorText(error));
    yield feed(VALIDATE_FIELD, {
      progress: progressSnapshot({
        phase: 'failed',
        processed,
        total,
        ok: false,
        error: errorText(error),
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
        message: errorText(error),
      }),
      result: bulkValidateResult(rows, wouldCreate, conflicts),
    });
  }
}

export async function* bulkCreateLeadsStream(_, { dataList }, context) {
  const user = assertUser(context, 'lead:import');
  const businessId = user.business;
  const rows = dataList || [];
  const total = rows.length;
  const created = [];
  const merged = [];
  const duplicatesRequiringMode = [];
  const errors = [];
  let processed = 0;

  const result = () => ({ created, merged, duplicatesRequiringMode, errors });

  try {
    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({ phase: 'started', processed: 0, total, message: 'Creating leads' }),
    });

    for (let index = 0; index < rows.length; index += 1) {
      const input = rows[index];
      try {
        const {
          templateId, name, contactDetails, lastInteractedAt, nextFollowUpAt,
          source, tags, leadScore, status, notes, data, mode,
        } = input;

        const duplicateQuery = buildDuplicateQuery(contactDetails, businessId);
        const existingLead = duplicateQuery ? await Lead.findOne(duplicateQuery) : null;
        let outcome = 'CREATED';
        let lead = null;
        let duplicate = null;

        if (existingLead) {
          if (!mode || !['merge', 'new'].includes(mode)) {
            const matched = findMatchedHandles(contactDetails, existingLead);
            duplicate = { input, existingLeadId: existingLead._id, matchedOn: matched };
            duplicatesRequiringMode.push(duplicate);
            outcome = 'DUPLICATE';
          } else if (mode === 'merge') {
            const mergedContactDetails = mergeContactDetails(
              existingLead.contactDetails?.toObject?.() || existingLead.contactDetails,
              contactDetails
            );
            lead = await Lead.findByIdAndUpdate(
              existingLead._id,
              {
                $set: {
                  contactDetails: mergedContactDetails,
                  ...(name && { name }),
                  ...(source && { source }),
                  ...(notes && { notes }),
                  ...(leadScore != null && { leadScore }),
                  ...(status && { status }),
                  ...(lastInteractedAt && { lastInteractedAt }),
                  ...(nextFollowUpAt && { nextFollowUpAt }),
                  ...(data && { data: { ...existingLead.data, ...data } }),
                },
                $addToSet: { tags: { $each: tags || [] } },
              },
              { new: true }
            );
            merged.push(lead);
            outcome = 'MERGED';
          }
        }

        if (outcome === 'CREATED') {
          lead = await Lead.create({
            template: templateId,
            contactDetails,
            lastInteractedAt,
            nextFollowUpAt,
            name, source, tags, leadScore,
            status: status || 'new',
            notes, data,
            business: businessId,
            createdBy: user._id,
          });
          created.push(lead);
        }

        processed += 1;
        yield feed(CREATE_FIELD, {
          progress: progressSnapshot({
            phase: 'progress',
            processed,
            total,
            index,
            ok: outcome !== 'DUPLICATE',
            message: outcome,
          }),
          index,
          outcome,
          lead,
          duplicate,
        });
      } catch (error) {
        console.error('Error creating lead input:', input);
        console.error('Error creating lead error:', error);
        errors.push({ input, error: error.message });
        processed += 1;
        yield feed(CREATE_FIELD, {
          progress: progressSnapshot({
            phase: 'progress',
            processed,
            total,
            index,
            ok: false,
            error: error.message,
            message: 'ERROR',
          }),
          index,
          outcome: 'ERROR',
          itemError: error.message,
        });
      }
    }

    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({
        phase: 'completed',
        processed: total,
        total,
        ok: errors.length === 0,
        message: 'Import finished',
      }),
      result: result(),
    });
  } catch (error) {
    console.error('bulkCreateLeadsProgress:', errorText(error));
    yield feed(CREATE_FIELD, {
      progress: progressSnapshot({
        phase: 'failed',
        processed,
        total,
        ok: false,
        error: errorText(error),
        code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
        message: errorText(error),
      }),
      result: result(),
    });
  }
}
