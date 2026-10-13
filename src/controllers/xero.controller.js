import { Contact } from "../models/Contact.js";
import { Invoice } from "../models/Invoice.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import {
  getConnectedIntegration,
  getProviderAccessToken,
  providerJson,
  requireEnvironment,
  isoDateOnly,
} from "../services/providerApi.service.js";

const XERO_API = "https://api.xero.com/api.xro/2.0";

async function xeroRequest(workspaceId, method, path, body) {
  const integration = await getConnectedIntegration(workspaceId, "xero");
  const accessToken = await getProviderAccessToken(workspaceId, "xero");
  const tenantId =
    integration.config?.tenantId ||
    integration.externalAccountId ||
    env.XERO_TENANT_ID;
  if (!tenantId) {
    throw new AppError(
      "Xero tenant ID is missing. Reconnect Xero or set XERO_TENANT_ID.",
      409,
      "XERO_TENANT_REQUIRED",
    );
  }
  return providerJson(
    `${XERO_API}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "xero-tenant-id": tenantId,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    "Xero",
  );
}

function xeroValidationError(result) {
  const record = result?.Invoices?.[0] || result?.Contacts?.[0];
  const errors = record?.ValidationErrors || result?.ValidationErrors || [];
  return errors
    .map((item) => item.Message)
    .filter(Boolean)
    .join("; ");
}

async function getOrCreateXeroContact(workspaceId, contact) {
  const name =
    `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
    contact.email;
  if (!name)
    throw new AppError(
      "The Banyan contact needs a name or email before syncing to Xero.",
      400,
      "XERO_CONTACT_DETAILS_REQUIRED",
    );

  const email = String(contact.email || "").trim();
  if (email) {
    const where = `EmailAddress="${email.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const query = new URLSearchParams({ where, page: "1" });
    const lookup = await xeroRequest(
      workspaceId,
      "GET",
      `/Contacts?${query.toString()}`,
    );
    const match = lookup?.Contacts?.find(
      (item) =>
        String(item.EmailAddress || "").toLowerCase() === email.toLowerCase(),
    );
    if (match?.ContactID) return match.ContactID;
  }

  const body = {
    Contacts: [
      { Name: name.slice(0, 255), ...(email ? { EmailAddress: email } : {}) },
    ],
  };
  const created = await xeroRequest(workspaceId, "POST", "/Contacts", body);
  const record = created?.Contacts?.[0];
  if (record?.HasErrors || !record?.ContactID) {
    throw new AppError(
      xeroValidationError(created) ||
        "Xero did not return a ContactID for the synced contact.",
      502,
      "XERO_CONTACT_SYNC_FAILED",
    );
  }
  return record.ContactID;
}

export const syncXeroInvoice = asyncHandler(async (req, res) => {
  requireEnvironment("XERO_SALES_ACCOUNT_CODE");
  const invoice = await Invoice.findOne({
    _id: req.params.invoiceId,
    workspaceId: req.workspaceId,
  }).populate("contactId");
  if (!invoice) throw new AppError("Invoice not found.", 404, "NOT_FOUND");
  if (!invoice.contactId) {
    throw new AppError(
      "A contact must be linked to this invoice before syncing it to Xero.",
      400,
      "XERO_INVOICE_CONTACT_REQUIRED",
    );
  }
  if (invoice.status === "cancelled") {
    throw new AppError(
      "Cancelled invoices cannot be synced to Xero.",
      409,
      "XERO_INVOICE_CANCELLED",
    );
  }
  if (invoice.status === "paid") {
    throw new AppError(
      "Paid invoices need a separate Xero payment/reconciliation flow; this endpoint only syncs draft invoices.",
      409,
      "XERO_PAID_INVOICE_REQUIRES_RECONCILIATION",
    );
  }

  // Make sure the target tenant is connected before creating any accounting records.
  await getConnectedIntegration(req.workspaceId, "xero");
  const xeroContactId = await getOrCreateXeroContact(
    req.workspaceId,
    invoice.contactId,
  );
  const existingXeroInvoiceId =
    invoice.metadata?.xeroInvoiceId || invoice.externalId || "";
  const lineItem = {
    Description: String(
      invoice.description || invoice.invoiceNumber || "Banyan services",
    ).slice(0, 4000),
    Quantity: 1,
    UnitAmount: Number(invoice.subtotal || invoice.total || 0),
    AccountCode: env.XERO_SALES_ACCOUNT_CODE,
  };
  if (env.XERO_DEFAULT_TAX_TYPE) lineItem.TaxType = env.XERO_DEFAULT_TAX_TYPE;
  if (Number(invoice.tax || 0) >= 0)
    lineItem.TaxAmount = Number(invoice.tax || 0);

  const xeroInvoice = {
    Type: "ACCREC",
    Contact: { ContactID: xeroContactId },
    Date: isoDateOnly(invoice.createdAt || new Date()),
    ...(invoice.dueAt ? { DueDate: isoDateOnly(invoice.dueAt) } : {}),
    ...(invoice.invoiceNumber
      ? { InvoiceNumber: invoice.invoiceNumber.slice(0, 255) }
      : {}),
    CurrencyCode: String(invoice.currency || "HKD").toUpperCase(),
    LineAmountTypes: "Exclusive",
    LineItems: [lineItem],
    // Keep synced invoices in draft status to avoid issuing them without client approval.
    Status: "DRAFT",
    ...(invoice._id
      ? { Reference: `Banyan invoice ${invoice._id}`.slice(0, 255) }
      : {}),
  };
  if (existingXeroInvoiceId) xeroInvoice.InvoiceID = existingXeroInvoiceId;

  const result = await xeroRequest(req.workspaceId, "POST", "/Invoices", {
    Invoices: [xeroInvoice],
  });
  const returnedInvoice = result?.Invoices?.[0];
  if (returnedInvoice?.HasErrors || !returnedInvoice?.InvoiceID) {
    throw new AppError(
      xeroValidationError(result) ||
        "Xero did not return an InvoiceID for the invoice sync.",
      502,
      "XERO_INVOICE_SYNC_FAILED",
    );
  }

  invoice.provider = "xero";
  invoice.externalId = returnedInvoice.InvoiceID;
  invoice.metadata = {
    ...(invoice.metadata?.toObject
      ? invoice.metadata.toObject()
      : invoice.metadata || {}),
    xeroInvoiceId: returnedInvoice.InvoiceID,
    xeroInvoiceNumber:
      returnedInvoice.InvoiceNumber || invoice.invoiceNumber || "",
    xeroStatus: returnedInvoice.Status || "DRAFT",
    xeroSyncedAt: new Date(),
  };
  await invoice.save();

  return res.json({
    success: true,
    data: {
      invoiceId: invoice._id,
      xeroInvoiceId: returnedInvoice.InvoiceID,
      xeroInvoiceNumber: returnedInvoice.InvoiceNumber || null,
      xeroStatus: returnedInvoice.Status || "DRAFT",
      syncedAt: invoice.metadata.xeroSyncedAt,
    },
  });
});

export const getXeroInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.invoiceId,
    workspaceId: req.workspaceId,
  });
  if (!invoice) throw new AppError("Invoice not found.", 404, "NOT_FOUND");
  const xeroInvoiceId = invoice.metadata?.xeroInvoiceId || invoice.externalId;
  if (!xeroInvoiceId)
    throw new AppError(
      "This Banyan invoice has not been synced to Xero yet.",
      404,
      "XERO_INVOICE_NOT_SYNCED",
    );

  const result = await xeroRequest(
    req.workspaceId,
    "GET",
    `/Invoices/${encodeURIComponent(xeroInvoiceId)}`,
  );
  const external = result?.Invoices?.[0];
  if (!external)
    throw new AppError(
      "Invoice was not found in the connected Xero organisation.",
      404,
      "XERO_INVOICE_NOT_FOUND",
    );
  res.json({ success: true, data: external });
});

export const getXeroStatus = asyncHandler(async (req, res) => {
  const integration = await getConnectedIntegration(req.workspaceId, "xero");
  res.json({
    success: true,
    data: {
      connected: true,
      accountName: integration.accountName,
      tenantId:
        integration.config?.tenantId || integration.externalAccountId || null,
      lastSyncedAt: integration.lastSyncedAt || null,
    },
  });
});
