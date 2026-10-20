import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/database.js";
import { Workspace } from "../models/Workspace.js";
import { User } from "../models/User.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { pipelineDefinitions, keyForStage } from "./pipelineDefinitions.js";

const DEMO_TAG = "banyan-dashboard-demo-v1";
const PIPELINE_TOTALS = {
  membership: { count: 14, value: 486000, productType: "membership", stageCounts: [5, 3, 2, 2, 1, 0, 1] },
  "private-office": { count: 9, value: 1020000, productType: "private_office", stageCounts: [2, 0, 3, 0, 2, 1, 0, 0, 1] },
  "venue-hire": { count: 13, value: 268000, productType: "venue_hire", stageCounts: [4, 0, 0, 4, 3, 2, 0] },
  transactional: { count: 6, value: 66000, productType: "day_pass", stageCounts: [3, 2, 1] },
};
const SOURCES = [
  ...Array(14).fill("Website"),
  ...Array(9).fill("Referral"),
  ...Array(8).fill("Broker"),
  ...Array(6).fill("Instagram"),
  ...Array(5).fill("Other"),
];
const DAY_MS = 24 * 60 * 60 * 1000;

async function resolveWorkspace() {
  if (env.PUBLIC_ENQUIRY_WORKSPACE_ID) {
    if (!mongoose.isValidObjectId(env.PUBLIC_ENQUIRY_WORKSPACE_ID)) {
      throw new Error("PUBLIC_ENQUIRY_WORKSPACE_ID must be a valid MongoDB ObjectId.");
    }
    const workspace = await Workspace.findOne({ _id: env.PUBLIC_ENQUIRY_WORKSPACE_ID, isActive: true });
    if (!workspace) throw new Error("The configured PUBLIC_ENQUIRY_WORKSPACE_ID workspace was not found or is inactive.");
    return workspace;
  }
  const workspace = await Workspace.findOne({ slug: env.PUBLIC_ENQUIRY_WORKSPACE_SLUG, isActive: true });
  if (!workspace) {
    throw new Error(`Workspace not found. Configure PUBLIC_ENQUIRY_WORKSPACE_ID or PUBLIC_ENQUIRY_WORKSPACE_SLUG (${env.PUBLIC_ENQUIRY_WORKSPACE_SLUG}).`);
  }
  return workspace;
}

function distributeTotal(total, count) {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

try {
  await connectDatabase();
  const workspace = await resolveWorkspace();
  const owner = await User.findOne({ workspaceId: workspace._id, isActive: true, role: "admin" }).sort({ createdAt: 1 })
    || await User.findOne({ workspaceId: workspace._id, isActive: true }).sort({ createdAt: 1 });
  if (!owner) throw new Error(`No active user exists in workspace "${workspace.name}".`);

  const pipelines = await Pipeline.find({ workspaceId: workspace._id, isActive: true }).lean();
  const pipelineByKey = new Map(pipelines.map((pipeline) => [pipeline.key, pipeline]));
  const stageDocs = await PipelineStage.find({ workspaceId: workspace._id, isActive: true }).lean();
  const stageLookup = new Map();
  for (const stage of stageDocs) stageLookup.set(`${stage.pipelineId}:${stage.key}`, stage);

  // Refuse to create orphaned demo deals if the canonical four pipelines/stages have not been seeded.
  for (const definition of pipelineDefinitions) {
    const pipeline = pipelineByKey.get(definition.key);
    if (!pipeline) throw new Error(`Missing pipeline "${definition.name}". Run npm run seed:pipelines first.`);
    const missingStages = definition.stages.filter((name) => !stageLookup.has(`${pipeline._id}:${keyForStage(name)}`));
    if (missingStages.length) {
      throw new Error(`Pipeline "${definition.name}" is missing stages: ${missingStages.join(", ")}. Run npm run seed:pipelines first.`);
    }
  }

  const now = new Date();
  let createdDeals = 0;
  let updatedDeals = 0;
  let upsertedContacts = 0;
  const pipelineSummaries = [];
  let globalIndex = 0;

  for (const definition of pipelineDefinitions) {
    const profile = PIPELINE_TOTALS[definition.key];
    const pipeline = pipelineByKey.get(definition.key);
    const stageByKey = new Map(definition.stages.map((name) => [keyForStage(name), stageLookup.get(`${pipeline._id}:${keyForStage(name)}`)]));
    const dealValues = distributeTotal(profile.value, profile.count);
    let localIndex = 0;
    let totalWritten = 0;

    for (let stageIndex = 0; stageIndex < profile.stageCounts.length; stageIndex += 1) {
      const stageName = definition.stages[stageIndex];
      const stage = stageByKey.get(keyForStage(stageName));
      const stageCount = profile.stageCounts[stageIndex];
      for (let withinStage = 0; withinStage < stageCount; withinStage += 1) {
        localIndex += 1;
        globalIndex += 1;
        const suffix = String(globalIndex).padStart(2, "0");
        const demoKey = `${DEMO_TAG}:${definition.key}:${String(localIndex).padStart(2, "0")}`;
        const contactEmail = `dashboard-demo-${suffix}@example.invalid`;
        const firstName = ["Cynthia", "Meridian", "Harbour", "Kenneth", "Priya", "Lumen", "Adeline", "Nathan", "Delphine", "JoJo", "Alex", "Taylor"][globalIndex % 12];
        const lastName = `Demo ${suffix}`;
        const existingContact = await Contact.exists({ workspaceId: workspace._id, "metadata.dashboardDemoKey": demoKey });
        const contactDoc = await Contact.findOneAndUpdate(
          { workspaceId: workspace._id, "metadata.dashboardDemoKey": demoKey },
          {
            $set: {
              workspaceId: workspace._id,
              firstName,
              lastName,
              email: contactEmail,
              source: SOURCES[(globalIndex - 1) % SOURCES.length],
              language: "en",
              ownerId: owner._id,
              isArchived: false,
              metadata: { dashboardDemo: true, dashboardDemoKey: demoKey },
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
        );
        if (!existingContact) upsertedContacts += 1;

        const value = dealValues[localIndex - 1];
        const daysSinceActivity = localIndex % 6 === 0 ? 8 + (localIndex % 12) : localIndex % 4;
        const lastActivityAt = new Date(now.getTime() - daysSinceActivity * DAY_MS);
        const stageChangedAt = new Date(now.getTime() - Math.max(1, (stageIndex + 1) * 2) * DAY_MS);
        // Keep the sample opportunity distribution open so every visible stage contributes
        // to the dashboard pipeline totals, matching the reference screenshot. Deal outcome
        // remains a separate status field and can be changed through normal CRM workflows.
        const status = "open";
        const productType = definition.key === "transactional" && localIndex % 2 === 0 ? "meeting_room" : profile.productType;
        const source = SOURCES[(globalIndex - 1) % SOURCES.length];
        const existingDeal = await Deal.exists({ workspaceId: workspace._id, "metadata.dashboardDemoKey": demoKey });
        await Deal.findOneAndUpdate(
          { workspaceId: workspace._id, "metadata.dashboardDemoKey": demoKey },
          {
            $set: {
              workspaceId: workspace._id,
              title: `${definition.key === "membership" ? "Membership" : definition.key === "private-office" ? "Private office" : definition.key === "venue-hire" ? "Venue hire" : "Day pass"} enquiry — ${firstName} ${lastName}`,
              contactId: contactDoc._id,
              pipelineId: pipeline._id,
              stageId: stage._id,
              value,
              recurringValue: definition.key === "membership" || definition.key === "private-office" ? value : 0,
              currency: workspace.currency || "HKD",
              productType,
              source,
              expectedCloseDate: new Date(now.getTime() + (7 + (globalIndex % 45)) * DAY_MS),
              ownerId: owner._id,
              status,
              description: `Seeded dashboard demonstration deal (${DEMO_TAG}). Safe to rerun; this script only updates its own tagged demo records.`,
              lastActivityAt,
              nextActionAt: new Date(now.getTime() + (globalIndex % 5) * DAY_MS),
              stageChangedAt,
              metadata: { dashboardDemo: true, dashboardDemoTag: DEMO_TAG, dashboardDemoKey: demoKey },
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
        );
        if (existingDeal) updatedDeals += 1;
        else createdDeals += 1;
        totalWritten += value;
      }
    }
    pipelineSummaries.push({ name: definition.name, count: profile.count, value: totalWritten });
  }

  console.log(`Dashboard demo seed completed for workspace: ${workspace.name}`);
  console.log(`Tagged demo deals created: ${createdDeals}; updated: ${updatedDeals}; demo contacts inserted: ${upsertedContacts}.`);
  console.log("Demo pipeline totals (open + won deals):");
  for (const summary of pipelineSummaries) console.log(`- ${summary.name}: ${summary.count} deals · HK$${summary.value.toLocaleString("en-HK")}`);
  console.log("This seed does not delete or modify untagged CRM records. Rerunning is safe.");
} catch (error) {
  console.error("Dashboard demo seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
