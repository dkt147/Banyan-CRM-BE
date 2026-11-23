import crypto from "node:crypto";
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { makeResourceController } from "../controllers/resource.controller.js";
import { Form } from "../models/Form.js";
import { FormSubmission } from "../models/FormSubmission.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { createFormSchema, updateFormSchema } from "../validators/form.validators.js";
import { publishFormPage, removeFormPage } from "../services/wpFormPages.service.js";

// Forms (feedback 17 Nov, #5). Everyone can view; create/edit/delete need forms.manage (admin).
// Public submissions: routes/publicForms.routes.js.
const c = makeResourceController(resourceRegistry.forms.service);
const r = Router();
r.use(requireAuth);

const newPublicKey = () => crypto.randomBytes(24).toString("base64url"); // 32 characters

async function checkPipeline(workspaceId, { pipelineId, stageId }) {
  if (pipelineId && !(await Pipeline.exists({ _id: pipelineId, workspaceId })))
    throw new AppError("Pipeline not found.", 404, "PIPELINE_NOT_FOUND");
  if (stageId && !(await PipelineStage.exists({ _id: stageId, workspaceId, pipelineId })))
    throw new AppError("Stage not found in this pipeline.", 400, "INVALID_STAGE");
}

async function assertSlugFree(workspaceId, slug, exceptId) {
  const clash = await Form.exists({ workspaceId, slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (clash) throw new AppError(`Another form already uses the slug "${slug}".`, 409, "FORM_SLUG_TAKEN");
}

r.get("/", c.list);

r.post(
  "/",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const data = createFormSchema.parse(req.body || {});
    await assertSlugFree(req.workspaceId, data.slug);
    await checkPipeline(req.workspaceId, data);
    const form = await Form.create({
      ...data,
      workspaceId: req.workspaceId,
      publicKey: newPublicKey(),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    res.status(201).json({ success: true, data: form });
  }),
);

r.get("/:id/submissions", asyncHandler(async (req, res) => {
  const form = await Form.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).select("_id");
  if (!form) throw new AppError("Form not found.", 404, "NOT_FOUND");
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const filter = { workspaceId: req.workspaceId, formId: form._id, ...(req.query.status ? { status: String(req.query.status) } : {}) };
  const [items, total] = await Promise.all([
    FormSubmission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("contactId", "firstName lastName email").populate("dealId", "title").populate("dealIds", "title").select("-ip -userAgent").lean(),
    FormSubmission.countDocuments(filter),
  ]);
  res.json({ success: true, data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}));

r.post(
  "/:id/rotate-key",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const form = await Form.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      { $set: { publicKey: newPublicKey(), updatedBy: req.user._id } },
      { new: true },
    );
    if (!form) throw new AppError("Form not found.", 404, "NOT_FOUND");
    res.json({ success: true, data: form });
  }),
);

// Website page for the form (WordPress, §2.3). Body { path: "forms/walk-in" }. Idempotent.
r.post(
  "/:id/page",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!form) throw new AppError("Form not found.", 404, "NOT_FOUND");
    const page = await publishFormPage(form, req.body?.path);
    res.json({ success: true, data: { page } });
  }),
);
r.delete(
  "/:id/page",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!form) throw new AppError("Form not found.", 404, "NOT_FOUND");
    res.json({ success: true, data: await removeFormPage(form) });
  }),
);

r.get("/:id", c.get);

r.patch(
  "/:id",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!form) throw new AppError("Form not found.", 404, "NOT_FOUND");
    const patch = updateFormSchema.parse(req.body || {});
    // Validate the form as it will be saved (e.g. a stage needs the pipeline it belongs to).
    const current = form.toObject();
    createFormSchema.parse({
      name: current.name, slug: current.slug, type: current.type, fields: current.fields,
      pipelineId: current.pipelineId ? String(current.pipelineId) : null,
      stageId: current.stageId ? String(current.stageId) : null,
      ...patch,
    });
    if (patch.slug && patch.slug !== form.slug) await assertSlugFree(req.workspaceId, patch.slug, form._id);
    await checkPipeline(req.workspaceId, {
      pipelineId: "pipelineId" in patch ? patch.pipelineId : form.pipelineId,
      stageId: "stageId" in patch ? patch.stageId : form.stageId,
    });
    form.set({ ...patch, updatedBy: req.user._id });
    await form.save();
    res.json({ success: true, data: form });
  }),
);

// Soft delete when submissions exist (keeps the audit trail), hard delete otherwise.
r.delete(
  "/:id",
  requirePermission("forms.manage"),
  asyncHandler(async (req, res) => {
    const form = await Form.findOne({ _id: req.params.id, workspaceId: req.workspaceId });
    if (!form) throw new AppError("Form not found.", 404, "NOT_FOUND");
    if (await FormSubmission.exists({ workspaceId: req.workspaceId, formId: form._id })) {
      form.isActive = false;
      form.updatedBy = req.user._id;
      await form.save();
      return res.json({ success: true, data: { id: String(form._id), deleted: false, deactivated: true } });
    }
    await form.deleteOne();
    res.json({ success: true, data: { id: String(form._id), deleted: true } });
  }),
);

export default r;
