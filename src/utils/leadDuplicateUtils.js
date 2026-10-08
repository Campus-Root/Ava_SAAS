// utils/leadDuplicateUtils.js

import { parsePhoneNumber } from 'libphonenumber-js';

const CONTACT_PLATFORMS = ['whatsapp', 'telegram', 'email', 'phone', 'twitter', 'instagram', 'facebook'];
const PHONE_PLATFORMS = new Set(['phone', 'whatsapp']);

/**
 * Phone and WhatsApp numbers that parse to the same E.164 value are one identity,
 * regardless of +, spaces, or a missing country code.
 */
export function canonicalPhone(handle, defaultCountry = 'IN') {
  const raw = String(handle || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const attempts = raw.startsWith('+') || !digits ? [raw] : [raw, `+${digits}`];
  for (const attempt of attempts) {
    try {
      const phone = parsePhoneNumber(attempt, defaultCountry);
      if (!phone?.isValid()) continue;
      return {
        e164: phone.number,
        nationalNumber: phone.nationalNumber,
        countryCallingCode: String(phone.countryCallingCode),
      };
    } catch {
      // try the next spelling
    }
  }
  return null;
}

export function handleKey(platform, handle) {
  const trimmed = String(handle || '').trim().toLowerCase();
  if (PHONE_PLATFORMS.has(platform)) {
    const phone = canonicalPhone(trimmed);
    if (phone) return `tel:${phone.e164}`;
  }
  return `${platform}:${trimmed}`;
}

function phoneHandlePattern(phone) {
  const cc = escapeRegex(phone.countryCallingCode);
  const national = phone.nationalNumber.split('').map((digit) => escapeRegex(digit)).join('[\\s\\-()]*');
  return `^\\+?(?:${cc}[\\s\\-()]*)?0?${national}$`;
}

/**
 * Mongo clause that matches this handle, including phone-number spelling variants
 * on both phone and WhatsApp.
 */
export function handleMatchClause(platform, handle) {
  const trimmed = String(handle || '').trim().toLowerCase();
  const phone = PHONE_PLATFORMS.has(platform) ? canonicalPhone(trimmed) : null;
  if (!phone) {
    return { [`contactDetails.${platform}`]: { $elemMatch: { handle: trimmed } } };
  }
  const pattern = phoneHandlePattern(phone);
  return {
    $or: ['phone', 'whatsapp'].map((name) => ({
      [`contactDetails.${name}.handle`]: { $regex: pattern },
    })),
  };
}

export function contactMatchClauses(contactDetails = {}) {
  const clauses = [];
  const seen = new Set();
  for (const { platform, handle, key } of extractHandles(contactDetails)) {
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push(handleMatchClause(platform, handle));
  }
  return clauses;
}

/**
 * Extracts all { platform, handle, key } pairs from a contactDetails object.
 * Skips entries with no handle. `key` is shared by phone and WhatsApp when
 * the number is the same person.
 */
export function extractHandles(contactDetails = {}) {
  const handles = [];
  for (const platform of CONTACT_PLATFORMS) {
    const entries = contactDetails[platform] || [];
    for (const entry of entries) {
      if (entry.handle?.trim()) {
        const handle = entry.handle.trim().toLowerCase();
        handles.push({ platform, handle, key: handleKey(platform, handle) });
      }
    }
  }
  return handles;
}

/**
 * Builds a MongoDB $or query to find any lead that shares at least one handle.
 * Returns null if no handles to match on.
 */
export function buildDuplicateQuery(contactDetails, businessId) {
  const orClauses = contactMatchClauses(contactDetails);
  if (!orClauses.length) return null;
  return { business: businessId, $or: orClauses };
}

/**
 * Merges incoming contactDetails into existing without losing data or creating dupes.
 * Deduplication key: platform + handle (case-insensitive).
 */
export function mergeContactDetails(existing = {}, incoming = {}) {
  const merged = {};

  for (const platform of CONTACT_PLATFORMS) {
    const existingEntries = existing[platform] || [];
    const incomingEntries = incoming[platform] || [];

    // Build a map of existing entries keyed by lowercased handle
    const seen = new Map();
    for (const entry of existingEntries) {
      const key = entry.handle?.trim() ? handleKey(platform, entry.handle) : `__nohandle_${Math.random()}`;
      seen.set(key, { ...entry });
    }

    // Merge incoming — update metadata/label/isPrimary if handle exists, else add new
    for (const entry of incomingEntries) {
      const key = entry.handle?.trim() ? handleKey(platform, entry.handle) : '';
      if (key && seen.has(key)) {
        // Update non-destructively: only overwrite if incoming has a value
        const existing = seen.get(key);
        seen.set(key, {
          ...existing,
          label: entry.label || existing.label,
          isPrimary: entry.isPrimary ?? existing.isPrimary,
          metadata: { ...existing.metadata, ...entry.metadata },
        });
      } else {
        const fallbackKey = key || `__nohandle_${Math.random()}`;
        seen.set(fallbackKey, { ...entry });
      }
    }

    merged[platform] = Array.from(seen.values());
  }

  return merged;
}

/**
 * Figures out which handles caused the match (for error reporting).
 */
export function findMatchedHandles(contactDetails, existingLead) {
  const incomingHandles = extractHandles(contactDetails);
  const existingHandles = extractHandles(existingLead.contactDetails?.toObject?.() || existingLead.contactDetails || {});

  const existingSet = new Set(existingHandles.map(h => h.key));
  return incomingHandles
    .filter(h => existingSet.has(h.key))
    .map(h => h.key);
}

/**
 * Builds a Map of "platform:handle" → lead from a list of existing leads.
 */
export function indexLeadsByHandle(leads = []) {
  const map = new Map();
  for (const lead of leads) {
    const details = lead.contactDetails?.toObject?.() || lead.contactDetails || {};
    for (const { key } of extractHandles(details)) {
      if (!map.has(key)) map.set(key, lead);
    }
  }
  return map;
}
export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Dry-run classify for bulk create: within-batch collisions + DB matches.
 * Does not write. `handleToLead` should be preloaded from DB (see indexLeadsByHandle).
 *
 * @returns {{ wouldCreate: Array, conflicts: Array }}
 */
/**
 * Classifies one bulk-create row against earlier rows in this batch and known leads.
 * Mutates `seenInBatch` when the row would be created.
 */
export function classifyBulkCreateRow(input, index, seenInBatch, handleToLead) {
  const handleKeys = extractHandles(input.contactDetails).map(({ key }) => key);

  const batchMatched = [];
  let conflictIndex = null;
  for (const key of handleKeys) {
    if (seenInBatch.has(key)) {
      batchMatched.push(key);
      if (conflictIndex == null) conflictIndex = seenInBatch.get(key);
    }
  }
  if (batchMatched.length) {
    return {
      outcome: 'WITHIN_BATCH',
      conflict: {
        index,
        input,
        reason: 'WITHIN_BATCH',
        conflictIndex,
        existingLeadId: null,
        matchedOn: batchMatched,
      },
    };
  }

  const dbMatched = [];
  let existingLead = null;
  for (const key of handleKeys) {
    if (handleToLead.has(key)) {
      dbMatched.push(key);
      if (!existingLead) existingLead = handleToLead.get(key);
    }
  }
  if (existingLead) {
    return {
      outcome: 'EXISTING_LEAD',
      conflict: {
        index,
        input,
        reason: 'EXISTING_LEAD',
        conflictIndex: null,
        existingLeadId: existingLead._id.toString(),
        matchedOn: dbMatched,
      },
    };
  }

  for (const key of handleKeys) {
    if (!seenInBatch.has(key)) seenInBatch.set(key, index);
  }
  return { outcome: 'WOULD_CREATE', row: { index, input } };
}

/**
 * Dry-run classify for bulk create: within-batch collisions + DB matches.
 * Does not write. `handleToLead` should be preloaded from DB (see indexLeadsByHandle).
 *
 * @returns {{ wouldCreate: Array, conflicts: Array }}
 */
export function classifyBulkCreateRows(dataList = [], handleToLead = new Map()) {
  const seenInBatch = new Map(); // handleKey → first index in this batch
  const wouldCreate = [];
  const conflicts = [];

  dataList.forEach((input, index) => {
    const classified = classifyBulkCreateRow(input, index, seenInBatch, handleToLead);
    if (classified.conflict) conflicts.push(classified.conflict);
    else wouldCreate.push(classified.row);
  });

  return { wouldCreate, conflicts };
}