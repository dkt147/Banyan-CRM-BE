import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { Contact } from "../models/Contact.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const r = Router();
r.use(requireAuth);
r.patch(
  "/:id/archive",
  asyncHandler(async (req, res) => {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      { isArchived: true },
      { new: true, runValidators: true },
    );
    if (!contact) throw new AppError("Contact not found", 404, "NOT_FOUND");
    res.json({ success: true, data: contact });
  }),
);
r.use(resourceRouter(resourceRegistry.contacts.service));
export default r;
