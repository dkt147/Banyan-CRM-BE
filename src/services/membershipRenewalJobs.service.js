import { Membership } from "../models/Membership.js";
import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { MembershipPlan } from "../models/MembershipPlan.js";
import { Contact } from "../models/Contact.js";
import { User } from "../models/User.js";
import { Task } from "../models/Task.js";
import { Integration } from "../models/Integration.js";
import { getProviderAccessToken, providerJson } from "./providerApi.service.js";

let running = false;
const DAY = 86400000;
function dayKey(date) { return new Date(date).toISOString().slice(0, 10); }
function encodeMail(to, subject, body) {
  const safe = (v) => String(v || "").replace(/[\r\n]/g, " ");
  const raw = [`To: ${safe(to)}`, `Subject: ${safe(subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}
async function sendRenewalEmail(workspaceId, to, name, days, endDate) {
  const integration = await Integration.findOne({ workspaceId, provider: "gmail", status: "connected" }).lean();
  if (!integration) return false;
  const token = await getProviderAccessToken(workspaceId, "gmail");
  await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ raw: encodeMail(to, "Banyan Virtual Office agreement renewal", `Dear ${name || "customer"},\n\nThis is a reminder that your Banyan Virtual Office agreement is due to end on ${new Date(endDate).toLocaleDateString("en-GB", { timeZone: "Asia/Hong_Kong" })}. Please contact the Banyan team to discuss renewal.\n\nKind regards,\nBanyan Workspace`) }),
  }, "Gmail renewal reminder");
  return true;
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
          const sent = await sendRenewalEmail(membership.workspaceId, contact.email, `${contact.firstName || ""} ${contact.lastName || ""}`.trim(), days, expiry);
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
          const sent = await sendRenewalEmail(deal.workspaceId, contact.email, `${contact.firstName || ""} ${contact.lastName || ""}`.trim(), days, expiry);
          if (!sent) continue;
          deal.metadata = { ...(deal.metadata?.toObject ? deal.metadata.toObject() : deal.metadata || {}), virtualOfficeRenewalReminderSent: { ...(deal.metadata?.virtualOfficeRenewalReminderSent || {}), [String(days)]: now } };
          await deal.save();
        } catch (error) { console.error("[virtual-office-renewal] email failed:", error.message); }
      }
    }
  } catch (error) { console.error("[membership-renewal] job failed:", error.message); }
  finally { running = false; }
}
