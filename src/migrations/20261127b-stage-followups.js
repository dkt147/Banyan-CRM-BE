/*
 * Follow-up task per pipeline stage (27 Nov b, C). Idempotent: only stages without a followUp get one.
 *   - name matches /quote sent/i -> { enabled: true, dueInDays: 3, title: "Quote follow-up: {deal}" }
 *   - every other stage           -> { enabled: false, dueInDays: 1, title: "" }
 * Also creates the Eventbrite Event / EventRegistration indexes (27 Nov b, A).
 */
import { Event } from "../models/Event.js";
import { EventRegistration } from "../models/EventRegistration.js";
import { PipelineStage } from "../models/PipelineStage.js";

export const id = "20261127b-stage-followups";

const missing = { followUp: { $exists: false } };

export async function up({ apply, log }) {
  const quote = { ...missing, name: /quote sent/i };
  const others = { ...missing, name: { $not: /quote sent/i } };
  const [q, o] = await Promise.all([PipelineStage.countDocuments(quote), PipelineStage.countDocuments(others)]);
  if (apply) {
    await PipelineStage.collection.updateMany(quote, { $set: { followUp: { enabled: true, dueInDays: 3, title: "Quote follow-up: {deal}" } } });
    await PipelineStage.collection.updateMany(others, { $set: { followUp: { enabled: false, dueInDays: 1, title: "" } } });
    await Event.createIndexes();
    await EventRegistration.createIndexes();
  }
  log(`${apply ? "created" : "would create"} Event and EventRegistration indexes`);
  log(`${apply ? "set" : "would set"} followUp on ${q} "Quote sent" stage(s) (on, 3 days) and ${o} other stage(s) (off)`);
}

export async function down({ apply, log }) {
  const n = await PipelineStage.countDocuments({ followUp: { $exists: true } });
  if (apply) await PipelineStage.collection.updateMany({ followUp: { $exists: true } }, { $unset: { followUp: "" } });
  log(`${apply ? "removed" : "would remove"} followUp from ${n} stage(s)`);
}
