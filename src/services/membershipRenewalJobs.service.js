import { Membership } from "../models/Membership.js";
import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { MembershipPlan } from "../models/MembershipPlan.js";
import { Contact } from "../models/Contact.js";
import { User } from "../models/User.js";
import { Task } from "../models/Task.js";
import { Integration } from "../models/Integration.js";
import { Template } from "../models/Template.js";
import { looksLikeHtml } from "../utils/mail.js";
import { sendWorkspaceEmail } from "./mail.service.js";
import { renderString, templateValues } from "./template.service.js";

let running = false;
const DAY = 86400000;
function dayKey(date) { return new Date(date).toISOString().slice(0, 10); }
// An active template with category "renewal_reminder" replaces the built-in text. Its
// {{variables}} are filled from the contact; {{endDate}} and {{daysLeft}} are also available.
async function sendRenewalEmail(workspaceId, contact, days, endDate) {
  const endLabel = new Date(endDate).toLocaleDateString("en-GB", { timeZone: "Asia/Hong_Kong", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const template = await Template.findOne({ workspaceId, category: "renewal_reminder", isActive: { $ne: false } }).sort({ updatedAt: -1 }).lean();
  if (template) {
    const values = { ...templateValues({ contact }), endDate: endLabel, daysLeft: String(days) };
    const isHtml = looksLikeHtml(template.body);
    return sendWorkspaceEmail(workspaceId, {
      to: contact.email,
      subject: renderString(template.subject, values).replace(/[\r\n]+/g, " "),
      ...(isHtml ? { html: renderString(template.body, values, { html: true }) } : { text: renderString(template.body, values) }),
      label: "Gmail renewal reminder",
    });
  }
  const name = `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
  return sendWorkspaceEmail(workspaceId, {
    to: contact.email,
    subject: "Banyan Virtual Office agreement renewal",
    text: `Dear ${name || "customer"},\n\nThis is a reminder that your Banyan Virtual Office agreement is due to end on ${endLabel}. Please contact the Banyan team to discuss renewal.\n\nKind regards,\nBanyan Workspace`,
    label: "Gmail renewal reminder",
  });
}

export async function runMembershipRenewalJobs() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const localParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const today = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day));
    const dueRows = await Membership.find({ status: { $in: ["active", "trial"] }, $or: [{ endAt: { $ne: null } }, { renewalAt: { $ne: null } }] }).limit(2000).lean();
    for (const membership of dueRows) {
      const expiry = membership.endAt || membership.renewalAt;
      if (!expiry || new Date(expiry) < today) continue;
      const days = Math.round((new Date(dayKey(expiry)) - today) / DAY);
      if (![60, 30].includes(days)) continue;
      const marker = `renewalReminder${days}SentAt`;
      if (membership.metadata?.[marker]) continue;
      const plan = membership.planId ? await MembershipPlan.findById(membership.planId).select("name type").lean() : null;
      const isVirtualOffice = /virtual\s*office/i.test(`${plan?.name || ""} ${membership.metadata?.productType || ""} ${membership.notes || ""}`);
      const contact = await Contact.findOne({ _id: membership.contactId, workspaceId: membership.workspaceId }).select("firstName lastName email").lean();
      if (!contact) continue;
      if (isVirtualOffice) {
        if (!contact.email) continue;
        try {
          const sent = await sendRenewalEmail(membership.workspaceId, contact, days, expiry);
          if (!sent) continue; // Gmail must be connected before direct customer emails can be sent.
        } catch (error) { console.error("[membership-renewal] email failed:", error.message); continue; }
      } else {
        let assignee = process.env.MEMBERSHIP_RENEWAL_ASSIGNEE_EMAIL
          ? await User.findOne({ workspaceId: membership.workspaceId, email: process.env.MEMBERSHIP_RENEWAL_ASSIGNEE_EMAIL.toLowerCase(), isActive: true }).select("_id").lean()
          : null;
        if (!assignee) assignee = await User.findOne({ workspaceId: membership.workspaceId, isActive: true, $or: [{ name: /jojo/i }, { email: /jojo/i }] }).select("_id").lean();
        if (!assignee) assignee = await User.findOne({ workspaceId: membership.workspaceId, role: "admin", isActive: true }).select("_id").lean();
        if (!assignee) continue;
        const title = `${days}-day renewal reminder: ${contact.firstName || "Member"} ${contact.lastName || ""}`.trim().slice(0, 200);
        const exists = await Task.exists({ workspaceId: membership.workspaceId, title, "metadata.membershipId": String(membership._id), "metadata.reminderDays": days });
        if (!exists) await Task.create({ workspaceId: membership.workspaceId, title, description: `Membership expires on ${new Date(expiry).toLocaleDateString("en-GB", { timeZone: "Asia/Hong_Kong" })}. Contact the member about renewal.`, contactId: membership.contactId, assignedTo: assignee._id, createdBy: assignee._id, dueAt: now, priority: "high", status: "pending", source: "automation", metadata: { membershipId: String(membership._id), reminderDays: days, trigger: "membership_renewal" } });
      }
      await Membership.updateOne({ _id: membership._id, workspaceId: membership.workspaceId }, { $set: { [`metadata.${marker}`]: now } });
    }
    // Virtual Office contracts are tracked on deals until/if a Membership record is created.
    const virtualPipelines = await Pipeline.find({ key: "virtual-office", isActive: true }).select("_id workspaceId").lean();
    for (const pipeline of virtualPipelines) {
      const activeStage = await PipelineStage.findOne({ workspaceId: pipeline.workspaceId, pipelineId: pipeline._id, key: "active", isActive: true }).select("_id").lean();
      if (!activeStage) continue;
      const deals = await Deal.find({ workspaceId: pipeline.workspaceId, pipelineId: pipeline._id, stageId: activeStage._id, membershipEndAt: { $ne: null } }).populate("contactId").limit(1000);
      for (const deal of deals) {
        const expiry = deal.membershipEndAt;
        if (!expiry || new Date(expiry) < today) continue;
        const days = Math.round((new Date(dayKey(expiry)) - today) / DAY);
        if (![60, 30].includes(days)) continue;
        if (deal.metadata?.virtualOfficeRenewalReminderSent?.[String(days)]) continue;
        const contact = deal.contactId;
        if (!contact?.email) continue;
        try {
          const sent = await sendRenewalEmail(deal.workspaceId, contact, days, expiry);
          if (!sent) continue;
          deal.metadata = { ...(deal.metadata?.toObject ? deal.metadata.toObject() : deal.metadata || {}), virtualOfficeRenewalReminderSent: { ...(deal.metadata?.virtualOfficeRenewalReminderSent || {}), [String(days)]: now } };
          await deal.save();
        } catch (error) { console.error("[virtual-office-renewal] email failed:", error.message); }
      }
    }
  } catch (error) { console.error("[membership-renewal] job failed:", error.message); }
  finally { running = false; }
}
