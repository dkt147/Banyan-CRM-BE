import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Activity } from "../models/Activity.js";
import { AppError } from "../utils/AppError.js";
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
  await Activity.create({
    workspaceId,
    userId,
    type: "deal_created",
    dealId: d._id,
    contactId: d.contactId,
    companyId: d.companyId,
    subject: "Deal created",
  });
  return getDeal(workspaceId, d._id);
}
export async function updateDeal(workspaceId, userId, id, payload) {
  const d = await Deal.findOne({ _id: id, workspaceId });
  if (!d) throw new AppError("Deal not found", 404, "NOT_FOUND");
  const patch = { ...payload };
  delete patch.workspaceId;
  delete patch.ownerId;
  if (patch.stageId && String(patch.stageId) !== String(d.stageId)) {
    const s = await PipelineStage.findOne({
      _id: patch.stageId,
      workspaceId,
      pipelineId: d.pipelineId,
    });
    if (!s) throw new AppError("Invalid stage", 400, "INVALID_STAGE");
    d.stageId = patch.stageId;
    d.stageChangedAt = new Date();
    if (s.isClosedWon) d.status = "won";
    if (s.isClosedLost) d.status = "lost";
    delete patch.stageId;
  }
  Object.assign(d, patch);
  await d.save();
  await Activity.create({
    workspaceId,
    userId,
    type: "stage_change",
    dealId: d._id,
    contactId: d.contactId,
    companyId: d.companyId,
    subject: "Deal updated",
    metadata: { changed: Object.keys(payload) },
  });
  return getDeal(workspaceId, id);
}
export async function moveDeal(workspaceId, userId, id, stageId) {
  return updateDeal(workspaceId, userId, id, { stageId });
}
export async function deleteDeal(workspaceId, id) {
  const d = await Deal.findOneAndDelete({ _id: id, workspaceId });
  if (!d) throw new AppError("Deal not found", 404, "NOT_FOUND");
  return d;
}
