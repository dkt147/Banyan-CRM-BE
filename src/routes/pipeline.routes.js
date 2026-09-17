import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import {
  createPipelineController,
  getPipelinesController,
  getPipelineController,
  updatePipelineController,
  createPipelineStageController,
  getPipelineStagesController,
  getPipelineWithStagesController,
  updatePipelineStageController,
  deletePipelineStageController
} from "../controllers/pipeline.controller.js";

const router = Router();

router.use(requireAuth);

/*
 * Pipelines
 */

router.post(
  "/",
  createPipelineController
);

router.get(
  "/",
  getPipelinesController
);

router.get(
  "/:pipelineId",
  getPipelineController
);

router.patch(
  "/:pipelineId",
  updatePipelineController
);

/*
 * Pipeline stages
 */

router.post(
  "/:pipelineId/stages",
  createPipelineStageController
);

router.get(
  "/:pipelineId/stages",
  getPipelineStagesController
);

router.get(
  "/:pipelineId/with-stages",
  getPipelineWithStagesController
);

router.patch(
  "/stages/:stageId",
  updatePipelineStageController
);

router.delete(
  "/stages/:stageId",
  deletePipelineStageController
);

export default router;