/*
 * Xero -> CRM invoice pull (client feedback 26 Nov, E). Invoices made in Xero show on the CRM's deals,
 * contacts and companies. READ-ONLY towards Xero: this module never writes to Xero.
 *
 *  - GET /Invoices (ACCREC), paged, with If-Modified-Since = last sync (first run: dated from 1 Jan 2026).
 *  - Upsert on { workspaceId, provider: "xero", externalId: InvoiceID }; source "xero_sync" on new ones.
 *  - Links (only filled when empty): Xero contact email -> CRM contact (+ its company); else Xero contact
 *    name -> CRM company. Deal: invoices the CRM pushed keep theirs; else "#<dealNumber>" in Reference.
 *    No CRM contacts are created from Xero.
 *  - A CRM invoice already marked paid is never moved back to unpaid by Xero.
 *  - Result kept in Integration.config.invoiceSync { lastSyncAt, lastResult, lastError }.
 */
import { env } from "../config/env.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Integration } from "../models/Integration.js";
import { Invoice } from "../models/Invoice.js";
import { Workspace } from "../models/Workspace.js";
import { AppError } from "../utils/AppError.js";
import { getConnectedIntegration, getProviderAccessToken, providerJson } from "./providerApi.service.js";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const FIRST_SYNC_WHERE = 'Type=="ACCREC" AND Date>=DateTime(2026,01,01)';
const PAGE_SIZE = 100; // Xero's page size for /Invoices?page=
const MAX_PAGES = 50;
const MAX_ONLINE_LINKS = 20; // per run, to stay well inside Xero's 60 calls/minute

async function xeroGet(workspaceId, path, headers = {}) {
  const integration = await getConnectedIntegration(workspaceId, "xero");
  const accessToken = await getProviderAccessToken(workspaceId, "xero");
  const tenantId = integration.config?.tenantId || integration.externalAccountId || env.XERO_TENANT_ID;
  if (!tenantId) throw new AppError("Xero tenant ID is missing. Reconnect Xero.", 409, "XERO_TENANT_REQUIRED");
  return providerJson(
    `${XERO_API}${path}`,
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": tenantId, Accept: "application/json", ...headers } },
    "Xero",
  );
}

/** "/Date(1767225600000+0000)/" or "2026-01-01T00:00:00" -> Date | null. */
export function xeroDate(value) {
  if (!value) return null;
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(String(value));
  if (m) return new Date(Number(m[1]));
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Xero status -> CRM invoice status. */
export function mapXeroStatus(inv, now = new Date()) {
  switch (String(inv.Status || "").toUpperCase()) {
    case "DRAFT":
    case "SUBMITTED":
      return "draft";
    case "PAID":
      return "paid";
    case "VOIDED":
    case "DELETED":
      return "cancelled";
    case "AUTHORISED": {
      const due = xeroDate(inv.DueDateString || inv.DueDate);
      return due && due < now ? "overdue" : "awaiting";
    }
    default:
      return "draft";
  }
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function syncOwner(workspaceId, integration) {
  if (integration.connectedBy) return integration.connectedBy;
  const ws = await Workspace.findById(workspaceId).select("createdBy").lean();
  if (!ws?.createdBy) throw new AppError("No user to record as the creator of synced invoices.", 409, "XERO_SYNC_OWNER_MISSING");
  return ws.createdBy;
}

/** POST /integrations/xero/sync-invoices, and the 30-minute job. */
export async function syncXeroInvoices(workspaceId, { now = new Date() } = {}) {
  const integration = await getConnectedIntegration(workspaceId, "xero");
  const state = integration.config?.invoiceSync || {};
  const startedAt = new Date();
  const result = { fetched: 0, created: 0, updated: 0, linkedToContact: 0, linkedToCompany: 0, linkedToDeal: 0, unmatched: 0, onlineLinks: 0 };
  try {
    const createdBy = await syncOwner(workspaceId, integration);
    // Overlap 5 minutes so an invoice edited during the last run isn't missed.
    const since = state.lastSyncAt ? new Date(new Date(state.lastSyncAt).getTime() - 5 * 60000) : null;
    const headers = since ? { "If-Modified-Since": since.toUTCString() } : {};
    const where = since ? 'Type=="ACCREC"' : FIRST_SYNC_WHERE;

    const invoices = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = new URLSearchParams({ where, order: "UpdatedDateUTC ASC", page: String(page) });
      const data = await xeroGet(workspaceId, `/Invoices?${q}`, headers);
      const rows = data?.Invoices || [];
      invoices.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    result.fetched = invoices.length;

    // Xero contact details (email) for the contacts on these invoices, 50 ids per call.
    const xeroContacts = new Map();
    const ids = [...new Set(invoices.map((i) => i.Contact?.ContactID).filter(Boolean))];
    for (const i of invoices) if (i.Contact?.ContactID && i.Contact.EmailAddress) xeroContacts.set(i.Contact.ContactID, i.Contact);
    const missing = ids.filter((id) => !xeroContacts.has(id));
    for (let i = 0; i < missing.length; i += 50) {
      const data = await xeroGet(workspaceId, `/Contacts?IDs=${missing.slice(i, i + 50).join(",")}`);
      for (const c of data?.Contacts || []) xeroContacts.set(c.ContactID, c);
    }

    const contactCache = new Map();
    const companyCache = new Map();
    async function crmContactFor(email) {
      const key = String(email || "").trim().toLowerCase();
      if (!key) return null;
      if (!contactCache.has(key))
        contactCache.set(
          key,
          await Contact.findOne({ workspaceId, email: new RegExp(`^${escapeRx(key)}$`, "i") }).sort({ isArchived: 1, createdAt: 1 }).select("_id companyId").lean(),
        );
      return contactCache.get(key);
    }
    async function crmCompanyFor(name) {
      const key = String(name || "").trim().toLowerCase();
      if (!key) return null;
      if (!companyCache.has(key))
        companyCache.set(key, await Company.findOne({ workspaceId, name: new RegExp(`^${escapeRx(key)}$`, "i") }).sort({ isArchived: 1 }).select("_id").lean());
      return companyCache.get(key);
    }

    let onlineBudget = MAX_ONLINE_LINKS;
    for (const inv of invoices) {
      if (!inv.InvoiceID) continue;
      const xc = xeroContacts.get(inv.Contact?.ContactID) || inv.Contact || {};
      const existing = await Invoice.findOne({ workspaceId, provider: "xero", externalId: inv.InvoiceID });
      const doc = existing || new Invoice({ workspaceId, provider: "xero", externalId: inv.InvoiceID, source: "xero_sync", createdBy });

      let status = mapXeroStatus(inv, now);
      if (doc.status === "paid" && !["paid", "cancelled"].includes(status)) status = "paid"; // never "unpay" a CRM payment
      doc.set({
        invoiceNumber: inv.InvoiceNumber || doc.invoiceNumber,
        total: Number(inv.Total ?? doc.total ?? 0),
        subtotal: Number(inv.SubTotal ?? doc.subtotal ?? 0),
        tax: Number(inv.TotalTax ?? doc.tax ?? 0),
        currency: String(inv.CurrencyCode || doc.currency || "HKD").toUpperCase(),
        dueAt: xeroDate(inv.DueDateString || inv.DueDate) || doc.dueAt,
        paidAt: xeroDate(inv.FullyPaidOnDate) || (status === "paid" ? doc.paidAt : null),
        status,
        description: String(inv.LineItems?.[0]?.Description || doc.description || inv.Reference || "").slice(0, 2000) || undefined,
      });

      // Links, only when the CRM invoice has none yet.
      let linked = false;
      if (!doc.contactId) {
        const contact = await crmContactFor(xc.EmailAddress);
        if (contact) {
          doc.contactId = contact._id;
          result.linkedToContact++;
          linked = true;
          if (!doc.companyId && contact.companyId) {
            doc.companyId = contact.companyId;
            result.linkedToCompany++;
          }
        }
      } else linked = true;
      if (!doc.companyId) {
        const company = await crmCompanyFor(xc.Name);
        if (company) {
          doc.companyId = company._id;
          result.linkedToCompany++;
          linked = true;
        }
      } else linked = true;
      if (!doc.dealId) {
        const m = /#(\d{4,})/.exec(String(inv.Reference || ""));
        const deal = m ? await Deal.findOne({ workspaceId, dealNumber: Number(m[1]) }).select("_id contactId companyId").lean() : null;
        if (deal) {
          doc.dealId = deal._id;
          if (!doc.contactId && deal.contactId) doc.contactId = deal.contactId;
          if (!doc.companyId && deal.companyId) doc.companyId = deal.companyId;
          result.linkedToDeal++;
          linked = true;
        }
      }
      if (!linked) result.unmatched++;

      const meta = { ...(doc.metadata || {}) };
      Object.assign(meta, {
        xeroInvoiceId: inv.InvoiceID,
        xeroInvoiceNumber: inv.InvoiceNumber || meta.xeroInvoiceNumber || "",
        xeroStatus: inv.Status || null,
        xeroContactId: xc.ContactID || inv.Contact?.ContactID || null,
        xeroContactName: xc.Name || null,
        xeroReference: inv.Reference || null,
        xeroAmountDue: Number(inv.AmountDue ?? 0),
        xeroUpdatedAt: xeroDate(inv.UpdatedDateUTC),
        xeroPulledAt: new Date(),
      });
      // Customer-facing link for unpaid invoices (optional, capped per run).
      if (["awaiting", "overdue"].includes(status) && !meta.onlineInvoiceUrl && onlineBudget > 0) {
        onlineBudget--;
        try {
          const online = await xeroGet(workspaceId, `/Invoices/${encodeURIComponent(inv.InvoiceID)}/OnlineInvoice`);
          const url = online?.OnlineInvoices?.[0]?.OnlineInvoiceUrl;
          if (url && /^https:\/\//i.test(url)) {
            meta.onlineInvoiceUrl = url;
            result.onlineLinks++;
          }
        } catch {
          // Not every invoice has an online link (e.g. not yet sent); skip quietly.
        }
      }
      doc.metadata = meta;
      doc.markModified("metadata");
      const isNew = doc.isNew;
      await doc.save();
      if (isNew) result.created++;
      else result.updated++;
    }

    await Integration.updateOne(
      { _id: integration._id },
      { $set: { lastSyncedAt: startedAt, "config.invoiceSync": { lastSyncAt: startedAt, lastResult: result, lastError: null } } },
    );
    return result;
  } catch (error) {
    await Integration.updateOne(
      { _id: integration._id },
      { $set: { "config.invoiceSync": { ...state, lastError: String(error.message).slice(0, 300), lastErrorAt: new Date() } } },
    ).catch(() => {});
    throw error;
  }
}

/** Every 30 minutes for every workspace with Xero connected. Never throws. */
let jobRunning = false;
export async function runXeroInvoiceSyncJob() {
  if (jobRunning) return;
  jobRunning = true;
  try {
    const rows = await Integration.find({ provider: "xero", status: "connected" }).select("workspaceId").lean();
    for (const row of rows) {
      try {
        const r = await syncXeroInvoices(row.workspaceId);
        if (r.created || r.updated) console.log(`[xero-sync] ${r.fetched} fetched, +${r.created} new, ${r.updated} updated, ${r.unmatched} unmatched`);
      } catch (error) {
        console.error("[xero-sync]", error.message);
      }
    }
  } finally {
    jobRunning = false;
  }
}
