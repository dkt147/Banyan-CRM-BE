import { asyncHandler } from "../utils/asyncHandler.js";
import { Workspace } from "../models/Workspace.js";
import { AppError } from "../utils/AppError.js";
export const get = asyncHandler(async (req, res) => {
  const w = await Workspace.findById(req.workspaceId);
  res.json({ success: true, data: w });
});
export const update = asyncHandler(async (req, res) => {
  if (!["admin"].includes(req.user.role))
    throw new AppError(
      "Only workspace admins can update settings",
      403,
      "FORBIDDEN",
    );
  const allowed = ["name", "description", "logoUrl", "timezone", "currency"];
  const patch = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k)),
  );
  const w = await Workspace.findByIdAndUpdate(req.workspaceId, patch, {
    new: true,
    runValidators: true,
  });
  res.json({ success: true, data: w });
});
