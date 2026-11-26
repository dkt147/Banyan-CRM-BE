import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAudit } from "../utils/audit.js";
import { createNote, deleteNote, listNotes, updateNote } from "../services/notes.service.js";

// Notes (client feedback 26 Nov, A). Stored as Activity { type: "note" }.
const r = Router();
r.use(requireAuth);

r.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await listNotes(req.workspaceId, req.query) });
  }),
);

r.post(
  "/",
  requirePermission("records.write"),
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await createNote(req.workspaceId, req.user, req.body || {}) });
  }),
);

// Author or admin (checked in the service: 403 NOT_NOTE_AUTHOR).
r.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await updateNote(req.workspaceId, req.user, req.params.id, req.body || {}) });
  }),
);

r.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const before = await deleteNote(req.workspaceId, req.user, req.params.id);
    await writeAudit(req, { action: "note.deleted", entityType: "note", entityId: req.params.id, before });
    res.json({ success: true, data: { id: req.params.id, deleted: true } });
  }),
);

export default r;
