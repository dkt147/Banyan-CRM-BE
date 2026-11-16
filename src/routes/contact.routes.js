import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createContactController,
  getContactsController,
  getContactController,
  updateContactController,
  archiveContactController,
  deleteContactController,
} from "../controllers/contact.controller.js";
import { getContactTagCounts } from "../services/contact.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { MAX_TAGS_PER_CONTACT, TAG_CATALOGUE, TAG_PATTERN } from "../utils/contactTags.js";

const router = Router();

router.use(requireAuth);

router.post("/", createContactController);

router.get("/", getContactsController);

// Tag list for filters (distinct tags in use, with counts) and the catalogue of known tags.
// Declared before "/:contactId" so they are not read as contact IDs.
router.get(
  "/tags",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { tags: await getContactTagCounts(req.workspaceId) } });
  }),
);
router.get("/tag-catalogue", (_req, res) => {
  res.json({ success: true, data: { pattern: TAG_PATTERN.source, maxPerContact: MAX_TAGS_PER_CONTACT, tags: TAG_CATALOGUE } });
});

router.get("/:contactId", getContactController);

router.patch("/:contactId", updateContactController);

router.patch("/:contactId/archive", archiveContactController);

router.delete("/:contactId", deleteContactController);

export default router;
