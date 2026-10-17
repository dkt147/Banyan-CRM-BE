import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/database.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Workspace } from "../models/Workspace.js";

function keyFor(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

try {
  await connectDatabase();
  let workspace;
  if (env.PUBLIC_ENQUIRY_WORKSPACE_ID) {
    if (!mongoose.isValidObjectId(env.PUBLIC_ENQUIRY_WORKSPACE_ID)) {
      throw new Error("PUBLIC_ENQUIRY_WORKSPACE_ID must be a valid MongoDB ObjectId.");
    }
    workspace = await Workspace.findOne({ _id: env.PUBLIC_ENQUIRY_WORKSPACE_ID, isActive: true });
  } else {
    workspace = await Workspace.findOne({ slug: env.PUBLIC_ENQUIRY_WORKSPACE_SLUG, isActive: true });
  }
  if (!workspace) {
    throw new Error(`Workspace not found. Check PUBLIC_ENQUIRY_WORKSPACE_SLUG (${env.PUBLIC_ENQUIRY_WORKSPACE_SLUG}) or PUBLIC_ENQUIRY_WORKSPACE_ID.`);
  }

  const pipelines = await Pipeline.find({ workspaceId: workspace._id, isActive: true }).sort({ sortOrder: 1 });
  if (!pipelines.length) throw new Error("No active pipelines were found for the configured workspace.");

  for (const pipeline of pipelines) {
    const stages = await PipelineStage.find({ workspaceId: workspace._id, pipelineId: pipeline._id }).sort({ sortOrder: 1, createdAt: 1 });
    if (!stages.length) {
      console.warn(`Skipped ${pipeline.name}: no stages exist.`);
      continue;
    }

    const existingLost = stages.find((stage) => stage.isClosedLost || stage.key === "lost" || /^lost$/i.test(stage.name));
    if (existingLost) {
      existingLost.name = /^lost$/i.test(existingLost.name) ? existingLost.name : "Lost";
      existingLost.key = existingLost.key || "lost";
      existingLost.isClosedLost = true;
      existingLost.isClosedWon = false;
      existingLost.isActive = true;
      existingLost.probability = 0;
      await existingLost.save();
    } else {
      const maxOrder = stages.reduce((max, stage) => Math.max(max, Number(stage.sortOrder || 0)), -1);
      await PipelineStage.create({
        workspaceId: workspace._id,
        pipelineId: pipeline._id,
        name: "Lost",
        key: "lost",
        sortOrder: maxOrder + 1,
        probability: 0,
        isClosedWon: false,
        isClosedLost: true,
        isActive: true,
      });
    }

    const hasWon = stages.some((stage) => stage.isClosedWon && !stage.isClosedLost);
    if (!hasWon) {
      const terminal = [...stages].reverse().find((stage) => stage.isActive !== false && !stage.isClosedLost) || stages[0];
      terminal.isClosedWon = true;
      terminal.isClosedLost = false;
      terminal.probability = 100;
      await terminal.save();
    }
    console.log(`Configured Won/Lost close stages for: ${pipeline.name}`);
  }
  console.log(`Website enquiry pipeline setup completed for workspace: ${workspace.name}`);
} catch (error) {
  console.error("Website enquiry pipeline setup failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
