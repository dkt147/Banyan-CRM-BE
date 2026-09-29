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

const router = Router();

router.use(requireAuth);

router.post("/", createContactController);

router.get("/", getContactsController);

router.get("/:contactId", getContactController);

router.patch("/:contactId", updateContactController);

router.patch("/:contactId/archive", archiveContactController);

router.delete("/:contactId", deleteContactController);

export default router;
