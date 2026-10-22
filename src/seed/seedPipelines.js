import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/database.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { keyForStage, pipelineDefinitions } from "./pipelineDefinitions.js";

async function findWorkspace() {
  if (env.PUBLIC_ENQUIRY_WORKSPACE_ID) {
    if (!mongoose.isValidObjectId(env.PUBLIC_ENQUIRY_WORKSPACE_ID)) {
      throw new Error("PUBLIC_ENQUIRY_WORKSPACE_ID must be a valid MongoDB ObjectId.");
    }
    const workspace = await Workspace.findOne({
      _id: env.PUBLIC_ENQUIRY_WORKSPACE_ID,
      isActive: true,
    });
    if (!workspace) throw new Error("The workspace configured by PUBLIC_ENQUIRY_WORKSPACE_ID was not found or is inactive.");
    return workspace;
  }

  const workspace = await Workspace.findOne({
    slug: env.PUBLIC_ENQUIRY_WORKSPACE_SLUG,
    isActive: true,
  });
  if (!workspace) {
    throw new Error(
      `Workspace not found. Check PUBLIC_ENQUIRY_WORKSPACE_SLUG (${env.PUBLIC_ENQUIRY_WORKSPACE_SLUG}) or PUBLIC_ENQUIRY_WORKSPACE_ID.`,
    );
  }
  return workspace;
}

try {
  await connectDatabase();
  const workspace = await findWorkspace();

  // Pipeline.ownerId is required by the existing schema. Prefer an active
  // admin in this workspace; fall back to another active workspace user.
  const owner =
    (await User.findOne({
      workspaceId: workspace._id,
      role: "admin",
      isActive: true,
    }).sort({ createdAt: 1 })) ||
    (await User.findOne({ workspaceId: workspace._id, isActive: true }).sort({ createdAt: 1 }));

  if (!owner) {
    throw new Error(`No active user exists in workspace "${workspace.name}" to own the pipelines.`);
  }

  for (const definition of pipelineDefinitions) {
    const pipeline = await Pipeline.findOneAndUpdate(
      { workspaceId: workspace._id, key: definition.key },
      {
        $set: {
          name: definition.name,
          key: definition.key,
          ownerId: owner._id,
          sortOrder: definition.sortOrder,
          isActive: true,
        },
        $setOnInsert: { workspaceId: workspace._id },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );

    for (let index = 0; index < definition.stages.length; index += 1) {
      const name = definition.stages[index];
      const key = keyForStage(name);
      const isFinalStage = index === definition.stages.length - 1;
      await PipelineStage.updateOne(
        {
          workspaceId: workspace._id,
          pipelineId: pipeline._id,
          key,
        },
        {
          $set: {
            name,
            key,
            sortOrder: index,
            isActive: true,
            isClosedWon: false,
            isClosedLost: false,
            probability: isFinalStage ? 100 : 0,
          },
          $setOnInsert: {
            workspaceId: workspace._id,
            pipelineId: pipeline._id,
          },
        },
        { upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
    }

    console.log(`Seeded ${definition.name}: ${definition.stages.length} stages`);
  }

  console.log(`Pipeline seed complete for workspace: ${workspace.name}`);
  console.log("No pipelines or stages were deleted by this script.");
} catch (error) {
  console.error("Pipeline seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
