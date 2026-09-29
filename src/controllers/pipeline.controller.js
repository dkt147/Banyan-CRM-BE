import {
  createPipeline,
  getPipelines,
  getPipelineById,
  updatePipeline,
  createPipelineStage,
  getPipelineStages,
  getPipelineWithStages,
  updatePipelineStage,
  deletePipelineStage,
} from "../services/pipeline.service.js";

import {
  createPipelineSchema,
  updatePipelineSchema,
  pipelineIdParamSchema,
  pipelineStageIdParamSchema,
  createPipelineStageSchema,
  updatePipelineStageSchema,
  pipelineListQuerySchema,
} from "../validators/pipeline.validators.js";

export async function createPipelineController(req, res) {
  const data = createPipelineSchema.parse(req.body);

  const pipeline = await createPipeline(data, req.user.id);

  return res.status(201).json({
    success: true,
    message: "Pipeline created successfully.",
    data: pipeline,
  });
}

export async function getPipelinesController(req, res) {
  const query = pipelineListQuerySchema.parse(req.query);

  const pipelines = await getPipelines(req.user.id, query.includeInactive);

  return res.status(200).json({
    success: true,
    message: "Pipelines fetched successfully.",
    data: pipelines,
  });
}

export async function getPipelineController(req, res) {
  const { pipelineId } = pipelineIdParamSchema.parse(req.params);

  const pipeline = await getPipelineById(pipelineId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Pipeline fetched successfully.",
    data: pipeline,
  });
}

export async function updatePipelineController(req, res) {
  const { pipelineId } = pipelineIdParamSchema.parse(req.params);

  const data = updatePipelineSchema.parse(req.body);

  const pipeline = await updatePipeline(pipelineId, req.user.id, data);

  return res.status(200).json({
    success: true,
    message: "Pipeline updated successfully.",
    data: pipeline,
  });
}

export async function createPipelineStageController(req, res) {
  const { pipelineId } = pipelineIdParamSchema.parse(req.params);

  const data = createPipelineStageSchema.parse(req.body);

  const stage = await createPipelineStage(pipelineId, req.user.id, data);

  return res.status(201).json({
    success: true,
    message: "Pipeline stage created successfully.",
    data: stage,
  });
}

export async function getPipelineStagesController(req, res) {
  const { pipelineId } = pipelineIdParamSchema.parse(req.params);

  const stages = await getPipelineStages(pipelineId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Pipeline stages fetched successfully.",
    data: stages,
  });
}

export async function getPipelineWithStagesController(req, res) {
  const { pipelineId } = pipelineIdParamSchema.parse(req.params);

  const result = await getPipelineWithStages(pipelineId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Pipeline fetched successfully.",
    data: result,
  });
}

export async function updatePipelineStageController(req, res) {
  const { stageId } = pipelineStageIdParamSchema.parse(req.params);

  const data = updatePipelineStageSchema.parse(req.body);

  const stage = await updatePipelineStage(stageId, req.user.id, data);

  return res.status(200).json({
    success: true,
    message: "Pipeline stage updated successfully.",
    data: stage,
  });
}

export async function deletePipelineStageController(req, res) {
  const { stageId } = pipelineStageIdParamSchema.parse(req.params);

  const result = await deletePipelineStage(stageId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Pipeline stage deleted successfully.",
    data: result,
  });
}
