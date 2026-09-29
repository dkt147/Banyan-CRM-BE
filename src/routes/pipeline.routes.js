import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
const r = Router();
r.use(requireAuth); // Explicit pipeline handlers keep workspace scoping and stage relationships safe.
r.get(
  "/",
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await resourceRegistry.pipelines.service.list(
        req.workspaceId,
        req.query,
      ),
    }),
  ),
);
r.post(
  "/",
  asyncHandler(async (req, res) =>
    res.status(201).json({
      success: true,
      data: await resourceRegistry.pipelines.service.create(
        req.workspaceId,
        req.user._id,
        req.body,
      ),
    }),
  ),
);
r.get(
  "/:id",
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await resourceRegistry.pipelines.service.get(
        req.workspaceId,
        req.params.id,
      ),
    }),
  ),
);
r.patch(
  "/:id",
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await resourceRegistry.pipelines.service.update(
        req.workspaceId,
        req.params.id,
        req.user._id,
        req.body,
      ),
    }),
  ),
);
r.delete(
  "/:id",
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await resourceRegistry.pipelines.service.remove(
        req.workspaceId,
        req.params.id,
      ),
    }),
  ),
);
r.get(
  "/:id/stages",
  asyncHandler(async (req, res) =>
    res.json({
      success: true,
      data: await PipelineStage.find({
        workspaceId: req.workspaceId,
        pipelineId: req.params.id,
      }).sort({ sortOrder: 1 }),
    }),
  ),
);
r.post(
  "/:id/stages",
  asyncHandler(async (req, res) =>
    res.status(201).json({
      success: true,
      data: await PipelineStage.create({
        ...req.body,
        workspaceId: req.workspaceId,
        pipelineId: req.params.id,
      }),
    }),
  ),
);
r.patch(
  "/stages/:stageId",
  asyncHandler(async (req, res) => {
    const d = await PipelineStage.findOneAndUpdate(
      { _id: req.params.stageId, workspaceId: req.workspaceId },
      req.body,
      { new: true, runValidators: true },
    );
    if (!d) throw new AppError("Stage not found", 404, "NOT_FOUND");
    res.json({ success: true, data: d });
  }),
);
r.delete(
  "/stages/:stageId",
  asyncHandler(async (req, res) => {
    const d = await PipelineStage.findOneAndDelete({
      _id: req.params.stageId,
      workspaceId: req.workspaceId,
    });
    if (!d) throw new AppError("Stage not found", 404, "NOT_FOUND");
    res.json({ success: true, data: d });
  }),
);
export default r;
