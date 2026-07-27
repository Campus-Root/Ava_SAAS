// utils/leadDuplicateUtils.js

const CONTACT_PLATFORMS = ['whatsapp', 'telegram', 'email', 'phone', 'twitter', 'instagram', 'facebook'];

/**
 * Extracts all { platform, handle } pairs from a contactDetails object.
 * Skips entries with no handle.
 */
export function extractHandles(contactDetails = {}) {
  const handles = [];
  for (const platform of CONTACT_PLATFORMS) {
    const entries = contactDetails[platform] || [];
    for (const entry of entries) {
      if (entry.handle?.trim()) {
        handles.push({ platform, handle: entry.handle.trim().toLowerCase() });
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
  const handles = extractHandles(contactDetails);
  if (!handles.length) return null;
  const orClauses = handles.map(({ platform, handle }) => ({ [`contactDetails.${platform}`]: { $elemMatch: { handle } } }));
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
      const key = entry.handle?.trim().toLowerCase() || `__nohandle_${Math.random()}`;
      seen.set(key, { ...entry });
    }

    // Merge incoming — update metadata/label/isPrimary if handle exists, else add new
    for (const entry of incomingEntries) {
      const key = entry.handle?.trim().toLowerCase();
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

  const existingSet = new Set(existingHandles.map(h => `${h.platform}:${h.handle}`));
  return incomingHandles
    .filter(h => existingSet.has(`${h.platform}:${h.handle}`))
    .map(h => `${h.platform}:${h.handle}`);
}

/**
 * Builds a Map of "platform:handle" → lead from a list of existing leads.
 */
export function indexLeadsByHandle(leads = []) {
  const map = new Map();
  for (const lead of leads) {
    const details = lead.contactDetails?.toObject?.() || lead.contactDetails || {};
    for (const { platform, handle } of extractHandles(details)) {
      const key = `${platform}:${handle}`;
      if (!map.has(key)) map.set(key, lead);
    }
  }
  return map;
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
    const handleKeys = extractHandles(input.contactDetails).map(
      ({ platform, handle }) => `${platform}:${handle}`
    );

    // 1) Within-batch collision against an earlier row that wouldCreate
    const batchMatched = [];
    let conflictIndex = null;
    for (const key of handleKeys) {
      if (seenInBatch.has(key)) {
        batchMatched.push(key);
        if (conflictIndex == null) conflictIndex = seenInBatch.get(key);
      }
    }
    if (batchMatched.length) {
      conflicts.push({
        index,
        input,
        reason: 'WITHIN_BATCH',
        conflictIndex,
        existingLeadId: null,
        matchedOn: batchMatched,
      });
      return;
    }

    // 2) Existing lead in DB
    const dbMatched = [];
    let existingLead = null;
    for (const key of handleKeys) {
      if (handleToLead.has(key)) {
        dbMatched.push(key);
        if (!existingLead) existingLead = handleToLead.get(key);
      }
    }
    if (existingLead) {
      conflicts.push({
        index,
        input,
        reason: 'EXISTING_LEAD',
        conflictIndex: null,
        existingLeadId: existingLead._id.toString(),
        matchedOn: dbMatched,
      });
      return;
    }

    // 3) Clean — would create; claim handles for later within-batch checks
    wouldCreate.push({ index, input });
    for (const key of handleKeys) {
      if (!seenInBatch.has(key)) seenInBatch.set(key, index);
    }
  });

  return { wouldCreate, conflicts };
}