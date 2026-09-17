import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";

export async function createPipeline(data, ownerId) {
  const existing = await Pipeline.findOne({
    ownerId,
    key: data.key.toLowerCase()
  });

  if (existing) {
    throw new AppError(
      "A pipeline with this key already exists.",
      409,
      "PIPELINE_EXISTS"
    );
  }

  const pipeline = await Pipeline.create({
    ...data,
    key: data.key.toLowerCase(),
    ownerId
  });

  return pipeline;
}

export async function getPipelines(ownerId, includeInactive = false) {
  const filter = {
    ownerId
  };

  if (!includeInactive) {
    filter.isActive = true;
  }

  const pipelines = await Pipeline.find(filter)
    .sort({ sortOrder: 1, createdAt: 1 });

  return pipelines;
}

export async function getPipelineById(pipelineId, ownerId) {
  const pipeline = await Pipeline.findOne({
    _id: pipelineId,
    ownerId
  });

  if (!pipeline) {
    throw new AppError(
      "Pipeline not found.",
      404,
      "PIPELINE_NOT_FOUND"
    );
  }

  return pipeline;
}

export async function updatePipeline(pipelineId, ownerId, data) {
  if (data.key) {
    data.key = data.key.toLowerCase();

    const duplicate = await Pipeline.findOne({
      ownerId,
      key: data.key,
      _id: { $ne: pipelineId }
    });

    if (duplicate) {
      throw new AppError(
        "A pipeline with this key already exists.",
        409,
        "PIPELINE_EXISTS"
      );
    }
  }

  const pipeline = await Pipeline.findOneAndUpdate(
    {
      _id: pipelineId,
      ownerId
    },
    {
      $set: data
    },
    {
      new: true,
      runValidators: true
    }
  );

  if (!pipeline) {
    throw new AppError(
      "Pipeline not found.",
      404,
      "PIPELINE_NOT_FOUND"
    );
  }

  return pipeline;
}

export async function createPipelineStage(
  pipelineId,
  ownerId,
  data
) {
  await getPipelineById(pipelineId, ownerId);

  const key = data.key.toLowerCase();

  const existing = await PipelineStage.findOne({
    pipelineId,
    key
  });

  if (existing) {
    throw new AppError(
      "A stage with this key already exists in this pipeline.",
      409,
      "PIPELINE_STAGE_EXISTS"
    );
  }

  return PipelineStage.create({
    ...data,
    key,
    pipelineId
  });
}

export async function getPipelineStages(pipelineId, ownerId) {
  await getPipelineById(pipelineId, ownerId);

  return PipelineStage.find({
    pipelineId,
    isActive: true
  }).sort({
    sortOrder: 1
  });
}

export async function getPipelineWithStages(
  pipelineId,
  ownerId
) {
  const pipeline = await getPipelineById(
    pipelineId,
    ownerId
  );

  const stages = await PipelineStage.find({
    pipelineId: pipeline._id
  }).sort({
    sortOrder: 1
  });

  return {
    pipeline,
    stages
  };
}

export async function updatePipelineStage(
  stageId,
  ownerId,
  data
) {
  const stage = await PipelineStage.findById(stageId);

  if (!stage) {
    throw new AppError(
      "Pipeline stage not found.",
      404,
      "PIPELINE_STAGE_NOT_FOUND"
    );
  }

  await getPipelineById(stage.pipelineId, ownerId);

  if (data.key) {
    data.key = data.key.toLowerCase();

    const duplicate = await PipelineStage.findOne({
      pipelineId: stage.pipelineId,
      key: data.key,
      _id: { $ne: stageId }
    });

    if (duplicate) {
      throw new AppError(
        "A stage with this key already exists.",
        409,
        "PIPELINE_STAGE_EXISTS"
      );
    }
  }

  return PipelineStage.findByIdAndUpdate(
    stageId,
    {
      $set: data
    },
    {
      new: true,
      runValidators: true
    }
  );
}

export async function deletePipelineStage(
  stageId,
  ownerId
) {
  const stage = await PipelineStage.findById(stageId);

  if (!stage) {
    throw new AppError(
      "Pipeline stage not found.",
      404,
      "PIPELINE_STAGE_NOT_FOUND"
    );
  }

  await getPipelineById(stage.pipelineId, ownerId);

  const dealCount = await Deal.countDocuments({
    stageId
  });

  if (dealCount > 0) {
    throw new AppError(
      "Pipeline stage cannot be deleted because deals are using it.",
      409,
      "PIPELINE_STAGE_HAS_DEALS"
    );
  }

  await stage.deleteOne();

  return {
    id: stageId,
    deleted: true
  };
}