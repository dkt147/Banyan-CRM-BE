import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Activity } from "../models/Activity.js";
import { Task } from "../models/Task.js";
import { AppError } from "../utils/AppError.js";
import { fireDealTrigger } from "./automation.service.js";
export async function listDeals(workspaceId, q = {}) {
  const page = Math.max(+q.page || 1, 1),
    limit = Math.min(Math.max(+q.limit || 25, 1), 100),
    filter = { workspaceId };
  for (const k of [
    "pipelineId",
    "stageId",
    "status",
    "ownerId",
    "contactId",
    "companyId",
    "productType",
  ]) {
    if (q[k]) filter[k] = q[k];
  }
  if (q.search)
    filter.$or = [
      { title: { $regex: q.search, $options: "i" } },
      { source: { $regex: q.search, $options: "i" } },
    ];
  const [items, total] = await Promise.all([
    Deal.find(filter)
      .populate("contactId companyId pipelineId stageId ownerId")
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Deal.countDocuments(filter),
  ]);
  return {
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}
export async function getDeal(workspaceId, id) {
  const d = await Deal.findOne({ _id: id, workspaceId }).populate(
    "contactId companyId pipelineId stageId ownerId",
  );
  if (!d) throw new AppError("Deal not found", 404, "NOT_FOUND");
  return d;
}
export async function createDeal(workspaceId, userId, payload) {
  const [contact, pipeline, stage] = await Promise.all([
    Contact.findOne({ _id: payload.contactId, workspaceId }),
    Pipeline.findOne({ _id: payload.pipelineId, workspaceId }),
    PipelineStage.findOne({
      _id: payload.stageId,
      workspaceId,
      pipelineId: payload.pipelineId,
    }),
  ]);
  if (!contact)
    throw new AppError("Contact not found", 404, "CONTACT_NOT_FOUND");
  if (!pipeline)
    throw new AppError("Pipeline not found", 404, "PIPELINE_NOT_FOUND");
  if (!stage)
    throw new AppError(
      "Pipeline stage does not belong to this pipeline",
      400,
      "INVALID_STAGE",
    );
  if (
    payload.companyId &&
    !(await Company.exists({ _id: payload.companyId, workspaceId }))
  )
    throw new AppError("Company not found", 404, "COMPANY_NOT_FOUND");
  const d = await Deal.create({
    ...payload,
    workspaceId,
    ownerId: payload.ownerId || userId,
    stageChangedAt: new Date(),
  });
  await fireDealTrigger(workspaceId, userId, "deal_created", d).catch((error) => console.error("[configured-automation]", error.message));
  await Activity.create({
    workspaceId,
    userId,
    type: "deal_created",
    dealId: d._id,
    contactId: d.contactId,
    companyId: d.companyId,
    subject: "Deal created",
  });
  // A manually-created new enquiry must be answered on the same Hong Kong business day.
  const localDate = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const dueAt = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day, 15, 59, 59, 999));
  await Task.create({ workspaceId, title: `Respond to new enquiry — ${d.title}`.slice(0, 200), description: "Review this new deal and respond to the customer today.", contactId: d.contactId, companyId: d.companyId, dealId: d._id, assignedTo: d.ownerId, createdBy: userId, dueAt, priority: "high", status: "pending", source: "system", metadata: { trigger: "manual_deal_created" } });
  return getDeal(workspaceId, d._id);
}
export async function updateDeal(workspaceId, userId, id, payload) {
  const d = await Deal.findOne({ _id: id, workspaceId });
  if (!d) throw new AppError("Deal not found", 404, "NOT_FOUND");
  const patch = { ...payload };
  delete patch.workspaceId;
  delete patch.ownerId;
  const oldPipelineId = String(d.pipelineId);
  const targetPipelineId = patch.pipelineId || d.pipelineId;
  if (patch.pipelineId && String(patch.pipelineId) !== oldPipelineId) {
    const targetPipeline = await Pipeline.findOne({ _id: patch.pipelineId, workspaceId, isActive: true });
    if (!targetPipeline) throw new AppError("Target pipeline not found", 404, "PIPELINE_NOT_FOUND");
    if (!patch.stageId) {
      const firstStage = await PipelineStage.findOne({ workspaceId, pipelineId: targetPipeline._id, isActive: true }).sort({ sortOrder: 1 });
      if (!firstStage) throw new AppError("Target pipeline has no active stages", 400, "PIPELINE_HAS_NO_STAGES");
      patch.stageId = firstStage._id;
    }
    d.pipelineId = targetPipeline._id;
  }
  let newStage = null;
  let stageChanged = false;
  if (patch.stageId) {
    newStage = await PipelineStage.findOne({ _id: patch.stageId, workspaceId, pipelineId: targetPipelineId, isActive: true });
    if (!newStage) throw new AppError("Invalid stage for selected pipeline", 400, "INVALID_STAGE");
    if (String(patch.stageId) !== String(d.stageId) || String(targetPipelineId) !== oldPipelineId) {
      stageChanged = true;
      d.stageId = patch.stageId;
      d.stageChangedAt = new Date();
      d.lastActivityAt = new Date();
    }
    delete patch.stageId;
    delete patch.pipelineId;
  }
  if (patch.status === "lost" && !String(patch.lostReason || d.lostReason || "").trim()) {
    throw new AppError("A reason is required when marking a deal as Lost.", 400, "LOST_REASON_REQUIRED");
  }
  // Won is deliberately independent from the last pipeline stage. Finance must confirm receipt.
  if (patch.status === "won" && patch.paymentReceivedConfirmed !== true && d.metadata?.paymentReceivedConfirmed !== true) {
    throw new AppError("Confirm that payment has been received before marking this deal Won.", 400, "PAYMENT_CONFIRMATION_REQUIRED");
  }
  delete patch.paymentReceivedConfirmed;
  const previousStatus = d.status;
  Object.assign(d, patch);
  if (d.status === "won" && d.metadata) d.metadata.paymentReceivedConfirmed = true;
  await d.save();
  await Activity.create({
    workspaceId, userId, type: "deal_updated", dealId: d._id, contactId: d.contactId,
    companyId: d.companyId, subject: "Deal updated",
    metadata: { changed: Object.keys(payload), previousPipelineId: oldPipelineId, pipelineChanged: String(d.pipelineId) !== oldPipelineId },
  });
  if (newStage && stageChanged) {
    await runStageFollowUpAutomation(d, userId, newStage, workspaceId).catch((error) => console.error("[deal-automation]", error.message));
    await fireDealTrigger(workspaceId, userId, "deal_stage_changed", d).catch((error) => console.error("[configured-automation]", error.message));
  }
  if (previousStatus !== d.status) {
    await fireDealTrigger(workspaceId, userId, "deal_status_changed", d).catch((error) => console.error("[configured-automation]", error.message));
  }
  await fireDealTrigger(workspaceId, userId, "deal_updated", d).catch((error) => console.error("[configured-automation]", error.message));
  return getDeal(workspaceId, id);
}

async function runStageFollowUpAutomation(deal, userId, stage, workspaceId) {
  const { Task } = await import("../models/Task.js");
  const { Notification } = await import("../models/Notification.js");
  const { Contact } = await import("../models/Contact.js");
  const contact = await Contact.findOne({ _id: deal.contactId, workspaceId }).select("firstName lastName email").lean();
  const stageName = String(stage.name || "");
  const now = new Date();
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  // Idempotency: do not create duplicate stage tasks for the same deal/stage.
  const title = `Follow up: ${deal.title} — ${stageName}`.slice(0, 200);
  const exists = await Task.exists({ workspaceId, dealId: deal._id, title, status: { $nin: ["completed", "cancelled"] } });
  if (!exists) await Task.create({ workspaceId, title, description: `Follow up after deal moved to ${stageName}.`, contactId: deal.contactId, companyId: deal.companyId, dealId: deal._id, assignedTo: deal.ownerId || userId, createdBy: userId, dueAt, priority: "high", source: "automation", metadata: { trigger: "deal_stage_changed", stageId: String(stage._id) } });
  await Notification.create({ workspaceId, userId: deal.ownerId || userId, type: "deal_stage_changed", title: `Deal moved to ${stageName}`, body: `${deal.title} moved to ${stageName}. A follow-up task was created.`, entityType: "deal", entityId: deal._id, channel: "in_app" });
  if (/quote sent/i.test(stageName)) {
    const quoteTaskTitle = `Quote follow-up: ${deal.title}`.slice(0, 200);
    const quoteExists = await Task.exists({ workspaceId, dealId: deal._id, title: quoteTaskTitle, status: { $nin: ["completed", "cancelled"] } });
    if (!quoteExists) await Task.create({ workspaceId, title: quoteTaskTitle, description: `Follow up on the quote if the customer has not responded.`, contactId: deal.contactId, companyId: deal.companyId, dealId: deal._id, assignedTo: deal.ownerId || userId, createdBy: userId, dueAt: new Date(now.getTime() + 3 * 86400000), priority: "high", source: "automation", metadata: { trigger: "quote_sent_no_response", delayDays: 3 } });
  }
}
export async function moveDeal(workspaceId, userId, id, stageId) {
  return updateDeal(workspaceId, userId, id, { stageId });
}
export async function deleteDeal(workspaceId, id) {
  const d = await Deal.findOneAndDelete({ _id: id, workspaceId });
  if (!d) throw new AppError("Deal not found", 404, "NOT_FOUND");
  return d;
}


