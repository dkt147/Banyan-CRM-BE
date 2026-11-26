/*
 * Editable contact tags (client feedback 26 Nov, D).
 *  - Seeded from TAG_CATALOGUE on first use per workspace: only missing keys are inserted, so labels the
 *    team edited are never overwritten. Source tags are isSystem (the CRM adds them automatically).
 *  - No delete: archiving (isActive false) hides a tag from pickers; contacts keep it.
 */
import { ContactTag } from "../models/ContactTag.js";
import { AppError } from "../utils/AppError.js";
import { TAG_CATALOGUE, TAG_PATTERN } from "../utils/contactTags.js";

const seeded = new Set();
const GROUP_ORDER = { segment: 0, source: 1 };

export async function ensureContactTags(workspaceId) {
  const k = String(workspaceId);
  if (seeded.has(k)) return;
  const existing = new Set(await ContactTag.find({ workspaceId }).distinct("key"));
  const missing = TAG_CATALOGUE.map((t, i) => ({ ...t, sortOrder: i })).filter((t) => !existing.has(t.key));
  if (missing.length) {
    try {
      await ContactTag.insertMany(
        missing.map((t) => ({
          workspaceId, key: t.key, label: t.label, description: t.description || "", group: t.group,
          isSystem: t.group === "source" || Boolean(t.automatic), sortOrder: t.sortOrder,
        })),
        { ordered: false },
      );
    } catch (error) {
      // Another request seeded the same keys at the same time.
      const dupOnly = error?.code === 11000 || (Array.isArray(error?.writeErrors) && error.writeErrors.every((e) => e.code === 11000));
      if (!dupOnly) throw error;
    }
  }
  seeded.add(k);
}
/** Tests drop the database between runs. */
export function resetContactTagSeedCache() {
  seeded.clear();
}

const sortTags = (rows) =>
  rows.sort(
    (a, b) =>
      (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9) ||
      (a.sortOrder || 0) - (b.sortOrder || 0) ||
      a.label.localeCompare(b.label),
  );

export function toTag(t) {
  return {
    _id: t._id, id: String(t._id), key: t.key, label: t.label, description: t.description || "", group: t.group,
    isActive: t.isActive !== false, isSystem: Boolean(t.isSystem), automatic: Boolean(t.isSystem), sortOrder: t.sortOrder || 0,
  };
}

export async function listContactTags(workspaceId, { includeInactive = false } = {}) {
  await ensureContactTags(workspaceId);
  const rows = await ContactTag.find({ workspaceId, ...(includeInactive ? {} : { isActive: { $ne: false } }) }).lean();
  return sortTags(rows).map(toTag);
}

/** key -> label, for timelines, reports and exports. Unknown keys fall back to the key. */
export async function tagLabelMap(workspaceId) {
  await ensureContactTags(workspaceId);
  const rows = await ContactTag.find({ workspaceId }).select("key label").lean();
  return new Map(rows.map((t) => [t.key, t.label]));
}

/** "VIP Client!" -> "vip_client". */
export function tagKeyFromLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50)
    .replace(/_+$/g, "");
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cleanText(value, max, field) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new AppError(`The ${field} can be at most ${max} characters.`, 400, "VALIDATION_ERROR");
  return text;
}

async function assertLabelFree(workspaceId, label, exceptId) {
  const clash = await ContactTag.findOne({
    workspaceId,
    label: new RegExp(`^${escapeRx(label)}$`, "i"),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).select("label isActive").lean();
  if (clash)
    throw new AppError(`A tag called "${clash.label}" already exists${clash.isActive === false ? " (archived)" : ""}.`, 409, "TAG_EXISTS");
}

/** POST /contact-tags { label, description, group } (admin). */
export async function createContactTag(workspaceId, body = {}) {
  await ensureContactTags(workspaceId);
  const label = cleanText(body.label, 50, "label");
  if (!label) throw new AppError("Give the tag a name.", 400, "INVALID_TAG");
  const key = tagKeyFromLabel(label);
  if (!key || !TAG_PATTERN.test(key)) throw new AppError("The tag name needs at least one letter or number.", 400, "INVALID_TAG");
  const description = cleanText(body.description, 200, "description");
  const group = body.group === undefined || body.group === null ? "segment" : body.group;
  if (!["segment", "source"].includes(group)) throw new AppError("group must be segment or source.", 400, "VALIDATION_ERROR");
  const sameKey = await ContactTag.findOne({ workspaceId, key }).select("label isActive").lean();
  if (sameKey)
    throw new AppError(`A tag with the key "${key}" already exists ("${sameKey.label}"${sameKey.isActive === false ? ", archived" : ""}).`, 409, "TAG_EXISTS");
  await assertLabelFree(workspaceId, label);
  const last = await ContactTag.findOne({ workspaceId, group }).sort({ sortOrder: -1 }).select("sortOrder").lean();
  try {
    const tag = await ContactTag.create({ workspaceId, key, label, description, group, sortOrder: (last?.sortOrder ?? -1) + 1 });
    return toTag(tag.toObject());
  } catch (error) {
    if (error?.code === 11000) throw new AppError(`A tag with the key "${key}" already exists.`, 409, "TAG_EXISTS");
    throw error;
  }
}

/** PATCH /contact-tags/:id { label?, description?, group?, isActive?, sortOrder? } (admin). Returns { before, tag }. */
export async function updateContactTag(workspaceId, id, body = {}) {
  const tag = await ContactTag.findOne({ _id: id, workspaceId }).catch(() => null);
  if (!tag) throw new AppError("Tag not found.", 404, "NOT_FOUND");
  const before = toTag(tag.toObject());
  if (body.key !== undefined && body.key !== tag.key)
    throw new AppError("A tag's key can't change. Rename its label instead.", 400, "TAG_KEY_IMMUTABLE");
  if (body.label !== undefined) {
    const label = cleanText(body.label, 50, "label");
    if (!label) throw new AppError("Give the tag a name.", 400, "INVALID_TAG");
    await assertLabelFree(workspaceId, label, tag._id);
    tag.label = label;
  }
  if (body.description !== undefined) tag.description = cleanText(body.description, 200, "description");
  if (body.group !== undefined && body.group !== tag.group) {
    if (!["segment", "source"].includes(body.group)) throw new AppError("group must be segment or source.", 400, "VALIDATION_ERROR");
    if (tag.isSystem) throw new AppError("The group of a built-in source tag can't change.", 400, "TAG_SYSTEM_GROUP");
    tag.group = body.group;
  }
  if (body.isActive !== undefined) tag.isActive = Boolean(body.isActive);
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 10000)
      throw new AppError("sortOrder must be a whole number from 0 to 10000.", 400, "VALIDATION_ERROR");
    tag.sortOrder = n;
  }
  await tag.save();
  return { before, tag: toTag(tag.toObject()) };
}
