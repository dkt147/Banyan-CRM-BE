import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { Company } from "../models/Company.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const r = Router();
r.use(requireAuth);
r.patch(
  "/:id/archive",
  asyncHandler(async (req, res) => {
    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      { isArchived: true },
      { new: true, runValidators: true },
    );
    if (!company) throw new AppError("Company not found", 404, "NOT_FOUND");
    res.json({ success: true, data: company });
  }),
);
r.use(resourceRouter(resourceRegistry.companies.service));
export default r;
