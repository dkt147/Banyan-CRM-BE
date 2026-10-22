import { Activity } from "../models/Activity.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const SERVICE_ROUTING = {
  "virtual office": { label: "Virtual Office", pipelineKey: "virtual-office", productType: "virtual_office" },
  "flexible day pass": { label: "Flexible Day Pass", pipelineKey: "transactional", productType: "day_pass" },
  "day pass package": { label: "Day Pass Packages", pipelineKey: "transactional", productType: "day_pass_package" },
  "day pass packages": { label: "Day Pass Packages", pipelineKey: "transactional", productType: "day_pass_package" },
  "coworking desk": { label: "Coworking Desks", pipelineKey: "membership", productType: "membership" },
  "coworking desks": { label: "Coworking Desks", pipelineKey: "membership", productType: "membership" },
  "serviced office": { label: "Serviced Offices", pipelineKey: "private-office", productType: "private_office" },
  "serviced offices": { label: "Serviced Offices", pipelineKey: "private-office", productType: "private_office" },
  "meeting room": { label: "Meeting Rooms", pipelineKey: "transactional", productType: "meeting_room" },
  "meeting rooms": { label: "Meeting Rooms", pipelineKey: "transactional", productType: "meeting_room" },
  "event venue": { label: "Event Venue", pipelineKey: "venue-hire", productType: "venue_hire" },
  "event space": { label: "Event Venue", pipelineKey: "venue-hire", productType: "venue_hire" },
  "photoshoot space": { label: "Photoshoot Space", pipelineKey: "venue-hire", productType: "venue_hire" },
  "photo shoot space": { label: "Photoshoot Space", pipelineKey: "venue-hire", productType: "venue_hire" },
  "podcast studio": { label: "Podcast Studio", pipelineKey: "venue-hire", productType: "studio" },
};


function endOfDayInTimeZone(date, timeZone = "Asia/Hong_Kong") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const local = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const p = Object.fromEntries(local.filter(x => x.type !== "literal").map(x => [x.type, Number(x.value)]));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 999);
    const correction = target - represented; guess += correction; if (!correction) break;
  }
  return new Date(guess);
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function resolveServices(input) {
  if (Array.isArray(input) && input.length > 1) {
    throw new AppError("Please select only one service per website enquiry. The team can add other deals manually in CRM.", 400, "MULTIPLE_ENQUIRY_SERVICES_NOT_ALLOWED");
  }
  const services = [];
  const seen = new Set();
  for (const raw of input) {
    const normalized = normalizeKey(raw);
    const service = SERVICE_ROUTING[normalized];
    if (!service) {
      throw new AppError(`Unsupported enquiry service: ${String(raw).slice(0, 80)}`, 400, "INVALID_ENQUIRY_SERVICE");
    }
    if (!seen.has(service.label)) {
      seen.add(service.label);
      services.push(service);
    }
  }
  if (!services.length) {
    throw new AppError("Please select at least one service.", 400, "ENQUIRY_SERVICE_REQUIRED");
  }
  return services;
}

async function getIntakeContext() {
  let workspace = null;
  if (env.PUBLIC_ENQUIRY_WORKSPACE_ID) {
    if (!/^[0-9a-fA-F]{24}$/.test(env.PUBLIC_ENQUIRY_WORKSPACE_ID)) {
      throw new AppError("PUBLIC_ENQUIRY_WORKSPACE_ID is invalid.", 503, "ENQUIRY_WORKSPACE_NOT_CONFIGURED");
    }
    workspace = await Workspace.findOne({ _id: env.PUBLIC_ENQUIRY_WORKSPACE_ID, isActive: true });
  } else {
    workspace = await Workspace.findOne({ slug: env.PUBLIC_ENQUIRY_WORKSPACE_SLUG, isActive: true });
  }
  if (!workspace) {
    throw new AppError("The website enquiry workspace is not configured or is inactive.", 503, "ENQUIRY_WORKSPACE_NOT_CONFIGURED");
  }

  let owner = await User.findOne({ _id: workspace.createdBy, workspaceId: workspace._id, isActive: true });
  if (!owner) {
    owner = await User.findOne({ workspaceId: workspace._id, role: "admin", isActive: true }).sort({ createdAt: 1 });
  }
  if (!owner) {
    throw new AppError("No active CRM user is available to own website enquiries.", 503, "ENQUIRY_OWNER_NOT_CONFIGURED");
  }
  return { workspace, owner };
}

function chooseStage(stages) {
  return stages.find((stage) => /^(enquiry|inquiry|new lead)$/i.test(stage.key || "") || /^(enquiry|inquiry|new lead)$/i.test(stage.name || "")) || stages[0] || null;
}

function groupedServiceLabel(services) {
  return services.map((service) => service.label).join(", ");
}

function productTypeForGroup(services, pipelineKey) {
  const types = [...new Set(services.map((service) => service.productType))];
  if (types.length === 1) return types[0];
  if (pipelineKey === "membership") return "membership";
  if (pipelineKey === "private-office") return "private_office";
  if (pipelineKey === "venue-hire") return "venue_hire";
  return "other";
}

export async function createPublicEnquiry(payload) {
  const services = resolveServices(payload.interests);
  const { workspace, owner } = await getIntakeContext();
  const pipelineKeys = [...new Set(services.map((service) => service.pipelineKey))];

  // Resolve every required pipeline and stage before writing any contact/deal.
  const pipelines = await Pipeline.find({
    workspaceId: workspace._id,
    isActive: true,
    key: { $in: pipelineKeys },
  });
  const pipelineByKey = new Map(pipelines.map((pipeline) => [pipeline.key, pipeline]));
  const missingPipeline = pipelineKeys.find((key) => !pipelineByKey.has(key));
  if (missingPipeline) {
    throw new AppError(
      `The required CRM pipeline "${missingPipeline}" is not configured. Run the website-enquiry setup script and try again.`,
      503,
      "ENQUIRY_PIPELINE_NOT_CONFIGURED",
    );
  }

  const pipelineIds = pipelines.map((pipeline) => pipeline._id);
  const pipelineStages = await PipelineStage.find({
    workspaceId: workspace._id,
    pipelineId: { $in: pipelineIds },
    isActive: true,
  }).sort({ sortOrder: 1, createdAt: 1 });
  const stageByPipelineId = new Map();
  for (const pipeline of pipelines) {
    const stages = pipelineStages.filter((stage) => String(stage.pipelineId) === String(pipeline._id));
    const initialStage = chooseStage(stages);
    if (!initialStage) {
      throw new AppError(
        `The CRM pipeline "${pipeline.name}" has no active stages. Add an Enquiry stage and try again.`,
        503,
        "ENQUIRY_STAGE_NOT_CONFIGURED",
      );
    }
    stageByPipelineId.set(String(pipeline._id), initialStage);
  }

  const email = payload.email.toLowerCase();
  const fullName = `${payload.firstName} ${payload.lastName}`.trim();
  let contact = await Contact.findOne({ workspaceId: workspace._id, email });
  if (!contact) {
    contact = await Contact.create({
      workspaceId: workspace._id,
      ownerId: owner._id,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email,
      phone: payload.phone || undefined,
      source: "website",
      tags: ["website_enquiry"],
      notes: payload.notes || undefined,
      language: "en",
      metadata: { websiteEnquiry: true, website: env.PUBLIC_WEBSITE_URL },
    });
  } else {
    contact.firstName = payload.firstName;
    contact.lastName = payload.lastName;
    if (payload.phone) contact.phone = payload.phone;
    if (!contact.source) contact.source = "website";
    contact.tags = [...new Set([...(contact.tags || []), "website_enquiry"])];
    if (payload.notes && !contact.notes) contact.notes = payload.notes;
    const existingOwnerIsActive = contact.ownerId
      ? await User.exists({ _id: contact.ownerId, workspaceId: workspace._id, isActive: true })
      : false;
    if (!existingOwnerIsActive) contact.ownerId = owner._id;
    await contact.save();
  }

  const currentContactOwner = await User.findOne({
    _id: contact.ownerId,
    workspaceId: workspace._id,
    isActive: true,
  }).select("_id");
  const leadOwnerId = currentContactOwner?._id || owner._id;
  if (!currentContactOwner) {
    contact.ownerId = owner._id;
    await contact.save();
  }

  const groups = new Map();
  for (const service of services) {
    if (!groups.has(service.pipelineKey)) groups.set(service.pipelineKey, []);
    groups.get(service.pipelineKey).push(service);
  }

  const receivedAt = new Date();
  const dealDocs = [];
  for (const [pipelineKey, groupServices] of groups.entries()) {
    const pipeline = pipelineByKey.get(pipelineKey);
    const stage = stageByPipelineId.get(String(pipeline._id));
    const serviceLabel = groupedServiceLabel(groupServices);
    const title = `Website enquiry — ${fullName}: ${serviceLabel}`.slice(0, 200);
    dealDocs.push({
      workspaceId: workspace._id,
      title,
      contactId: contact._id,
      pipelineId: pipeline._id,
      stageId: stage._id,
      value: 0,
      currency: workspace.currency || "HKD",
      productType: productTypeForGroup(groupServices, pipelineKey),
      source: "website",
      ownerId: leadOwnerId,
      status: "open",
      description: payload.notes || `Website enquiry for ${serviceLabel}.`,
      lastActivityAt: receivedAt,
      stageChangedAt: receivedAt,
      metadata: {
        sourceForm: "banyanworkspace.com — Find Your Space at Banyan",
        sourceUrl: env.PUBLIC_WEBSITE_URL,
        receivedAt,
        allInterests: services.map((service) => service.label),
        interestsForPipeline: groupServices.map((service) => service.label),
        requesterEmail: email,
        requesterPhone: payload.phone || "",
      },
    });
  }

  const deals = await Deal.create(dealDocs);
  for (const deal of deals) {
    try {
      await Activity.create({
        workspaceId: workspace._id,
        userId: leadOwnerId,
        type: "website_enquiry_received",
        contactId: contact._id,
        dealId: deal._id,
        subject: "Website enquiry received",
        body: payload.notes || `Interested in: ${deal.metadata?.interestsForPipeline?.join(", ") || "Banyan Workspace services"}`,
        occurredAt: receivedAt,
        metadata: { source: "website", interests: deal.metadata?.interestsForPipeline || [] },
      });
    } catch (activityError) {
      // Do not make a visitor retry a successfully stored enquiry just because its timeline event failed.
      console.error("[public-enquiry] Could not create activity:", activityError.message);
    }
  }

  // One follow-up task per enquiry, linked to the first opportunity to avoid duplicate tasks
  // when the visitor selects services that belong to more than one pipeline.
  let followUpTask = null;
  try {
    followUpTask = await Task.create({
      workspaceId: workspace._id,
      title: `Follow up: website enquiry — ${fullName}`.slice(0, 200),
      description: `Contact ${fullName} (${email}) before the end of today. Interested in: ${services.map((service) => service.label).join(", ")}.${payload.notes ? ` Notes: ${payload.notes}` : ""}`.slice(0, 5000),
      contactId: contact._id,
      dealId: deals[0]?._id,
      assignedTo: leadOwnerId,
      createdBy: leadOwnerId,
      dueAt: endOfDayInTimeZone(receivedAt, workspace.timezone || "Asia/Hong_Kong"),
      priority: "high",
      status: "pending",
      source: "system",
      metadata: { origin: "website_enquiry", allDealIds: deals.map((deal) => String(deal._id)) },
    });
  } catch (taskError) {
    // Lead capture must still succeed if task creation is temporarily unavailable.
    console.error("[public-enquiry] Could not create follow-up task:", taskError.message);
  }

  return {
    received: true,
    contactId: String(contact._id),
    deals: deals.map((deal) => ({
      id: String(deal._id),
      title: deal.title,
      pipeline: pipelines.find((pipeline) => String(pipeline._id) === String(deal.pipelineId))?.name || "Pipeline",
      stage: stageByPipelineId.get(String(deal.pipelineId))?.name || "Enquiry",
      status: deal.status,
      source: deal.source,
    })),
    followUpTaskId: followUpTask ? String(followUpTask._id) : null,
  };
}
