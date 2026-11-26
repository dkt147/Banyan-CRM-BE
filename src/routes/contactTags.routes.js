import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAudit } from "../utils/audit.js";
import { createContactTag, listContactTags, updateContactTag } from "../services/contactTags.service.js";

// Editable contact tags (client feedback 26 Nov, D). Any user reads; admins create and edit. No delete.
const r = Router();
r.use(requireAuth);

r.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeInactive = String(req.query.includeInactive) === "true";
    res.json({ success: true, data: { items: await listContactTags(req.workspaceId, { includeInactive }) } });
  }),
);

r.post(
  "/",
  requirePermission("workspace.manage"),
  asyncHandler(async (req, res) => {
    const tag = await createContactTag(req.workspaceId, req.body || {});
    await writeAudit(req, { action: "contact_tag.created", entityType: "contact_tag", entityId: tag._id, after: tag });
    res.status(201).json({ success: true, data: tag });
  }),
);

r.patch(
  "/:id",
  requirePermission("workspace.manage"),
  asyncHandler(async (req, res) => {
    const { before, tag } = await updateContactTag(req.workspaceId, req.params.id, req.body || {});
    await writeAudit(req, { action: "contact_tag.updated", entityType: "contact_tag", entityId: tag._id, before, after: tag });
    res.json({ success: true, data: tag });
  }),
);

export default r;
