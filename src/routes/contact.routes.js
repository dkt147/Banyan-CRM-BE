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
import { MAX_TAGS_PER_CONTACT, TAG_PATTERN } from "../utils/contactTags.js";
import { listContactTags } from "../services/contactTags.service.js";
import { contactBirthdays } from "../services/birthdays.service.js";

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
// The workspace's editable tag list (26 Nov, D), archived ones included (isActive: false) so their
// labels still show on contacts that have them.
router.get(
  "/tag-catalogue",
  asyncHandler(async (req, res) => {
    const tags = await listContactTags(req.workspaceId, { includeInactive: true });
    res.json({ success: true, data: { pattern: TAG_PATTERN.source, maxPerContact: MAX_TAGS_PER_CONTACT, tags } });
  }),
);
// Birthdays today and in the next ?days= days (26 Nov, C).
router.get(
  "/birthdays",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await contactBirthdays(req.workspaceId, { days: req.query.days }) });
  }),
);

router.get("/:contactId", getContactController);

router.patch("/:contactId", updateContactController);

router.patch("/:contactId/archive", archiveContactController);

router.delete("/:contactId", deleteContactController);

export default router;
