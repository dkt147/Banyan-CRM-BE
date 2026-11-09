import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getRelatedRecords } from "../services/related.service.js";

const r = Router();
r.use(requireAuth);

// GET /related/:type/:id  (type: contact | company | deal | task | booking)
r.get(
  "/:type/:id",
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await getRelatedRecords({
        type: req.params.type,
        id: req.params.id,
        workspaceId: req.workspaceId,
        userId: req.user._id,
        limit: req.query.limit,
      }),
    });
  }),
);

export default r;
