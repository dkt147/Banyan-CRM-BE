import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Activity } from "../models/Activity.js";
import { Task } from "../models/Task.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Template } from "../models/Template.js";
import { CalendarEvent } from "../models/CalendarEvent.js";
import { Booking } from "../models/Booking.js";
import { Agreement } from "../models/Agreement.js";
import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { MembershipPlan } from "../models/MembershipPlan.js";
import { Membership } from "../models/Membership.js";
import { CheckIn } from "../models/CheckIn.js";
import { LoyaltyTier } from "../models/LoyaltyTier.js";
import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
import { LoyaltyLedger } from "../models/LoyaltyLedger.js";
import { LoyaltyRedemption } from "../models/LoyaltyRedemption.js";
import { AutomationRule } from "../models/AutomationRule.js";
import { Integration } from "../models/Integration.js";
import { Notification } from "../models/Notification.js";
import { Document } from "../models/Document.js";
import { AuditLog } from "../models/AuditLog.js";
import { createResourceService } from "../services/resource.service.js";
const defs = {
  companies: [
    Company,
    {
      searchable: ["name", "legalName", "email"],
      filters: ["ownerId", "isArchived"],
      sortFields: ["createdAt", "name"],
      softDeleteField: "isArchived",
    },
  ],
  contacts: [
    Contact,
    {
      searchable: ["firstName", "lastName", "email", "phone"],
      filters: ["ownerId", "companyId", "isArchived", "language"],
      sortFields: ["createdAt", "firstName", "lastName"],
      softDeleteField: "isArchived",
      populate: ["companyId", "ownerId"],
    },
  ],
  pipelines: [
    Pipeline,
    {
      searchable: ["name", "key"],
      filters: ["isActive"],
      sortFields: ["sortOrder", "createdAt"],
      ownerField: "ownerId",
    },
  ],
  pipelineStages: [
    PipelineStage,
    {
      searchable: ["name", "key"],
      filters: ["pipelineId", "isActive"],
      sortFields: ["sortOrder", "createdAt"],
    },
  ],
  activities: [
    Activity,
    {
      searchable: ["subject", "body", "type"],
      filters: ["type", "contactId", "companyId", "dealId", "userId"],
      sortFields: ["occurredAt", "createdAt"],
      createdByField: "userId",
      populate: ["contactId", "companyId", "dealId", "userId"],
    },
  ],
  tasks: [
    Task,
    {
      searchable: ["title", "description"],
      filters: [
        "status",
        "priority",
        "assignedTo",
        "contactId",
        "companyId",
        "dealId",
      ],
      sortFields: ["dueAt", "createdAt"],
      createdByField: "createdBy",
      populate: ["assignedTo", "createdBy", "contactId", "companyId", "dealId"],
    },
  ],
  conversations: [
    Conversation,
    {
      searchable: ["participantName", "participantAddress", "subject"],
      filters: ["channel", "status", "assignedTo", "contactId", "dealId"],
      sortFields: ["lastMessageAt", "createdAt"],
      populate: ["contactId", "dealId", "assignedTo"],
    },
  ],
  messages: [
    Message,
    {
      searchable: ["body", "senderName", "senderAddress"],
      filters: ["conversationId", "direction", "status"],
      sortFields: ["sentAt", "createdAt"],
      populate: ["conversationId", "templateId"],
    },
  ],
  templates: [
    Template,
    {
      searchable: ["name", "subject", "category"],
      filters: ["category", "isActive"],
      sortFields: ["createdAt", "name"],
      createdByField: "createdBy",
      populate: ["createdBy", "updatedBy"],
    },
  ],
  calendar: [
    CalendarEvent,
    {
      searchable: ["title", "location", "type"],
      filters: ["status", "assignedTo", "contactId", "dealId"],
      sortFields: ["startAt", "createdAt"],
      populate: ["contactId", "companyId", "dealId", "assignedTo"],
    },
  ],
  bookings: [
    Booking,
    {
      searchable: ["resourceName", "bookingType"],
      filters: ["status", "contactId", "dealId"],
      sortFields: ["startAt", "createdAt"],
      createdByField: "createdBy",
      populate: ["contactId", "companyId", "dealId", "createdBy"],
    },
  ],
  agreements: [
    Agreement,
    {
      searchable: ["name", "status"],
      filters: ["status", "provider", "dealId"],
      sortFields: ["createdAt", "sentAt", "signedAt"],
      createdByField: "createdBy",
      populate: ["contactId", "companyId", "dealId", "createdBy"],
    },
  ],
  invoices: [
    Invoice,
    {
      searchable: ["invoiceNumber", "description", "status"],
      filters: [
        "status",
        "provider",
        "contactId",
        "companyId",
        "dealId",
        "membershipId",
      ],
      sortFields: ["dueAt", "createdAt", "paidAt"],
      createdByField: "createdBy",
      populate: [
        "contactId",
        "companyId",
        "dealId",
        "membershipId",
        "createdBy",
      ],
    },
  ],
  payments: [
    Payment,
    {
      searchable: ["provider", "externalId", "status"],
      filters: ["status", "invoiceId", "provider"],
      sortFields: ["createdAt", "paidAt"],
      populate: ["invoiceId"],
    },
  ],
  membershipPlans: [
    MembershipPlan,
    {
      searchable: ["name", "type"],
      filters: ["isActive", "billingInterval"],
      sortFields: ["createdAt", "name"],
    },
  ],
  memberships: [
    Membership,
    {
      searchable: ["memberCode", "status", "riskLevel"],
      filters: ["status", "contactId", "companyId", "planId", "riskLevel"],
      sortFields: ["renewalAt", "createdAt"],
      populate: ["contactId", "companyId", "planId"],
    },
  ],
  checkIns: [
    CheckIn,
    {
      searchable: ["source"],
      filters: ["membershipId", "contactId"],
      sortFields: ["checkedInAt", "createdAt"],
      populate: ["membershipId", "contactId"],
    },
  ],
  loyaltyTiers: [
    LoyaltyTier,
    {
      searchable: ["name"],
      filters: ["isActive"],
      sortFields: ["sortOrder", "minSpend"],
    },
  ],
  loyaltyAccounts: [
    LoyaltyAccount,
    {
      searchable: [],
      filters: ["contactId", "tierId"],
      sortFields: ["lifetimeSpend", "pointsBalance", "createdAt"],
      populate: ["contactId", "tierId"],
    },
  ],
  loyaltyLedger: [
    LoyaltyLedger,
    {
      searchable: ["type", "reason"],
      filters: ["accountId", "contactId", "type", "invoiceId"],
      sortFields: ["createdAt", "points"],
      createdByField: "createdBy",
      populate: ["accountId", "contactId", "invoiceId", "createdBy"],
    },
  ],
  loyaltyRedemptions: [
    LoyaltyRedemption,
    {
      searchable: ["rewardDescription", "status"],
      filters: ["status", "contactId", "dealId"],
      sortFields: ["requestedAt", "createdAt"],
      populate: ["accountId", "contactId", "dealId", "decidedBy"],
    },
  ],
  automationRules: [
    AutomationRule,
    {
      searchable: ["name", "description", "trigger"],
      filters: ["isEnabled", "trigger"],
      sortFields: ["createdAt", "name"],
      createdByField: "createdBy",
      populate: ["createdBy", "updatedBy"],
    },
  ],
  integrations: [
    Integration,
    {
      searchable: ["provider", "accountName", "status"],
      filters: ["provider", "status"],
      sortFields: ["createdAt", "lastSyncedAt"],
      populate: ["connectedBy"],
    },
  ],
  notifications: [
    Notification,
    {
      searchable: ["title", "body", "type"],
      filters: ["userId", "readAt", "channel"],
      sortFields: ["createdAt", "readAt"],
    },
  ],
  documents: [
    Document,
    {
      searchable: ["name", "type", "mimeType"],
      filters: ["type", "contactId", "companyId", "dealId", "agreementId"],
      sortFields: ["createdAt", "name"],
      createdByField: "uploadedBy",
      populate: [
        "contactId",
        "companyId",
        "dealId",
        "agreementId",
        "uploadedBy",
      ],
    },
  ],
  auditLogs: [
    AuditLog,
    {
      searchable: ["action", "entityType", "reason"],
      filters: ["actorId", "action", "entityType", "entityId"],
      sortFields: ["createdAt"],
      createdByField: "actorId",
      populate: ["actorId"],
    },
  ],
};
export const resourceRegistry = Object.fromEntries(
  Object.entries(defs).map(([key, [Model, cfg]]) => [
    key,
    { Model, service: createResourceService(Model, cfg) },
  ]),
);
