/*
 * Flodesk (client meeting 19 Nov, §3): consenting form submitters are added to Flodesk segments by
 * the interests they ticked. API: https://api.flodesk.com/v1, HTTP Basic auth (key as username).
 *
 *  - Segment IDs are looked up by name (GET /segments), cached for an hour. Segments are never created;
 *    a missing name is reported in the status and that segment is skipped.
 *  - Delivery is asynchronous (never blocks the form response) and retried on 429 / 5xx.
 *  - The result is stored on the submission: flodesk { status, segments, reason, at }.
 * Never log or return FLODESK_API_KEY.
 */
import { env } from "../config/env.js";
import { FormSubmission } from "../models/FormSubmission.js";

const API = "https://api.flodesk.com/v1/";
const SEGMENT_TTL_MS = 60 * 60 * 1000;

export const NO_PRODUCT_SEGMENT = "No Product [Automated]";
// CRM interest (lowercase) -> Flodesk segment name. Anything else goes to NO_PRODUCT_SEGMENT.
export const INTEREST_SEGMENTS = {
  coworking: "Coworking [Automated]",
  "coworking desk": "Coworking [Automated]",
  "coworking desks": "Coworking [Automated]",
  "flexible day pass": "Coworking [Automated]",
  "day pass package": "Coworking [Automated]",
  "day pass packages": "Coworking [Automated]",
  "serviced office": "Serviced Office [Automated]",
  "serviced offices": "Serviced Office [Automated]",
  "private office": "Serviced Office [Automated]",
  "virtual office": "Misc Products (Virtual Office) [Automated]",
  "event space / venue hire": "Event Space / Venue Hire [Automated]",
  "event space": "Event Space / Venue Hire [Automated]",
  "event venue": "Event Space / Venue Hire [Automated]",
  "venue hire": "Event Space / Venue Hire [Automated]",
  "photoshoot space": "Event Space / Venue Hire [Automated]",
  "photo shoot space": "Event Space / Venue Hire [Automated]",
  "podcast services": "Podcast Services [Automated]",
  "podcast studio": "Podcast Services [Automated]",
};
// Shown in GET /integrations/flodesk (one row per interest the CRM forms use).
const MAPPING_ROWS = [
  ["Coworking", "coworking"], ["Coworking Desks", "coworking desks"], ["Flexible Day Pass", "flexible day pass"],
  ["Serviced Office", "serviced office"], ["Serviced Offices", "serviced offices"], ["Virtual Office", "virtual office"],
  ["Event Space / Venue Hire", "event space / venue hire"], ["Event Venue", "event venue"], ["Photoshoot Space", "photoshoot space"],
  ["Podcast Services", "podcast services"], ["Podcast Studio", "podcast studio"], ["Anything else / none (e.g. Meeting Rooms)", null],
];

/** Segment names for a list of interests (several interests -> several segments). */
export function segmentNamesFor(interests = []) {
  const list = (Array.isArray(interests) ? interests : [interests]).map((i) => String(i || "").trim().toLowerCase()).filter(Boolean);
  if (!list.length) return [NO_PRODUCT_SEGMENT];
  return [...new Set(list.map((i) => INTEREST_SEGMENTS[i] || NO_PRODUCT_SEGMENT))];
}

export const isFlodeskConfigured = () => Boolean(env.FLODESK_API_KEY);

class FlodeskError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function flodesk(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(new URL(path, API), {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.FLODESK_API_KEY}:`).toString("base64")}`,
        Accept: "application/json",
        "User-Agent": "Banyan CRM",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new FlodeskError(`Flodesk is unreachable: ${error.message}`, 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new FlodeskError(`Flodesk ${method} ${path} returned ${res.status}${json?.message ? `: ${json.message}` : ""}`, res.status);
  return json;
}

const retryable = (error) => error.status === 0 || error.status === 429 || error.status >= 500;
async function withRetry(fn, retries = 3) {
  const base = Number(process.env.FLODESK_RETRY_BASE_MS ?? 1000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !retryable(error)) throw error;
      await new Promise((r) => setTimeout(r, base * 3 ** attempt));
    }
  }
}

let segmentCache = { at: 0, list: null };
/** [{ id, name }] from Flodesk, cached for an hour. */
export async function listSegments({ fresh = false } = {}) {
  if (!fresh && segmentCache.list && Date.now() - segmentCache.at < SEGMENT_TTL_MS) return segmentCache.list;
  const list = [];
  for (let page = 1; page <= 20; page++) {
    const json = await withRetry(() => flodesk(`segments?page=${page}&per_page=100`));
    for (const s of json.data || []) list.push({ id: String(s.id), name: String(s.name || "") });
    if (page >= Number(json.meta?.total_pages || 1)) break;
  }
  segmentCache = { at: Date.now(), list };
  return list;
}
export function resetFlodeskCache() {
  segmentCache = { at: 0, list: null };
}

/**
 * Does this submission allow a newsletter sign-up? Returns { ok, reason }.
 * A newsletterOptIn field decides when present; otherwise the form's consent box.
 */
export function flodeskConsent(form, { values = {}, consent = false } = {}) {
  const optField = (form.fields || []).find((f) => f.mapTo === "newsletterOptIn");
  if (optField) {
    const v = values[optField.key];
    const yes = (Array.isArray(v) ? v : [v]).some((x) => /^(yes|y|true|on|1)$/i.test(String(x || "").trim()));
    return yes ? { ok: true } : { ok: false, reason: `Answered "${Array.isArray(v) ? v.join(", ") : v || "no answer"}" to ${optField.label}.` };
  }
  if (form.consentText) return consent ? { ok: true } : { ok: false, reason: "The consent box was not ticked." };
  return { ok: false, reason: "The form has no newsletter question or consent box." };
}

/** Add or update one subscriber and put them in the segments for their interests. */
export async function addSubscriber({ email, firstName = "", lastName = "", interests = [] }) {
  if (!isFlodeskConfigured()) return { status: "skipped", segments: [], reason: "Flodesk isn't configured on the server (FLODESK_API_KEY)." };
  const wanted = segmentNamesFor(interests);
  const segments = await listSegments();
  const byName = new Map(segments.map((s) => [s.name.trim().toLowerCase(), s]));
  const found = wanted.map((n) => byName.get(n.toLowerCase())).filter(Boolean);
  const missing = wanted.filter((n) => !byName.has(n.toLowerCase()));

  await withRetry(() => flodesk("subscribers", { method: "POST", body: { email, first_name: firstName || undefined, last_name: lastName || undefined } }));
  // Add-only: never removes the subscriber from segments they are already in.
  if (found.length)
    await withRetry(() => flodesk(`subscribers/${encodeURIComponent(email)}/segments`, { method: "POST", body: { segment_ids: found.map((s) => s.id) } }));
  return {
    status: "added",
    segments: found.map((s) => s.name),
    reason: missing.length ? `Segment not found in Flodesk: ${missing.join(", ")}.` : null,
  };
}

/**
 * After a processed submission: decide, then deliver in the background. Writes submission.flodesk.
 * Returns the promise (tests await it; the form route does not).
 */
export function queueFlodeskForSubmission(form, submission, { values, consent, mapped, contact }) {
  if (!form.flodesk?.enabled) return Promise.resolve(null);
  const save = (flodeskState) =>
    FormSubmission.updateOne({ _id: submission._id }, { $set: { flodesk: { ...flodeskState, at: new Date() } } }).catch(() => {});
  const decision = flodeskConsent(form, { values, consent });
  const email = String(mapped.email || contact?.email || "").trim().toLowerCase();
  if (!decision.ok) return save({ status: "skipped", segments: [], reason: decision.reason });
  if (!email) return save({ status: "skipped", segments: [], reason: "No email address." });
  return new Promise((resolve) => setImmediate(resolve))
    .then(() => save({ status: "pending", segments: [], reason: null }))
    .then(() =>
      addSubscriber({
        email,
        firstName: contact?.firstName || mapped.firstName || "",
        lastName: contact?.lastName || mapped.lastName || "",
        interests: Array.isArray(mapped.interests) ? mapped.interests : [mapped.interests].filter(Boolean),
      }),
    )
    .then((result) => save(result))
    .catch((error) => {
      console.error("[flodesk] add subscriber failed:", error.message);
      return save({ status: "failed", segments: [], reason: String(error.message).slice(0, 300) });
    });
}

/** GET /integrations/flodesk */
export async function flodeskStatus(workspaceId) {
  const [lastOk, lastFail] = await Promise.all([
    FormSubmission.findOne({ workspaceId, "flodesk.status": "added" }).sort({ "flodesk.at": -1 }).select("flodesk").lean(),
    FormSubmission.findOne({ workspaceId, "flodesk.status": "failed" }).sort({ "flodesk.at": -1 }).select("flodesk").lean(),
  ]);
  let connected = false;
  let segments = [];
  let lastError = null;
  if (!isFlodeskConfigured()) lastError = "Flodesk isn't configured on the server (FLODESK_API_KEY).";
  else {
    try {
      segments = await listSegments({ fresh: true });
      connected = true;
    } catch (error) {
      lastError = error.message;
    }
  }
  const names = new Set(segments.map((s) => s.name.trim().toLowerCase()));
  const mapping = MAPPING_ROWS.map(([interest, key]) => {
    const segment = key ? INTEREST_SEGMENTS[key] : NO_PRODUCT_SEGMENT;
    return { interest, segment, found: connected ? names.has(segment.toLowerCase()) : null };
  });
  if (!lastError && lastFail && (!lastOk || lastFail.flodesk.at > lastOk.flodesk.at)) lastError = lastFail.flodesk.reason;
  return { connected, segments, mapping, lastError, lastSuccessAt: lastOk?.flodesk?.at || null };
}
