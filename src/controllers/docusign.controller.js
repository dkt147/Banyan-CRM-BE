import jwt from "jsonwebtoken";
import { Agreement } from "../models/Agreement.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import {
  docusignRequest,
  validateDocuSignConfiguration,
} from "../services/docusign.service.js";
import { requireEnvironment } from "../services/providerApi.service.js";

function signerInfo(agreement, body) {
  const contact = agreement.contactId;
  const email = String(body.recipientEmail || contact?.email || "").trim();
  const name = String(
    body.recipientName ||
      `${contact?.firstName || ""} ${contact?.lastName || ""}`.trim(),
  ).trim();
  if (!email || !email.includes("@") || /[\r\n]/.test(email)) {
    throw new AppError(
      "A valid recipientEmail is required (or link a contact with an email to the agreement).",
      400,
      "DOCUSIGN_RECIPIENT_EMAIL_REQUIRED",
    );
  }
  if (!name || /[\r\n]/.test(name)) {
    throw new AppError(
      "A recipientName is required (or link a named contact to the agreement).",
      400,
      "DOCUSIGN_RECIPIENT_NAME_REQUIRED",
    );
  }
  return { email, name };
}

export const sendDocuSignAgreement = asyncHandler(async (req, res) => {
  validateDocuSignConfiguration();
  const agreement = await Agreement.findOne({
    _id: req.params.agreementId,
    workspaceId: req.workspaceId,
  }).populate("contactId");
  if (!agreement) throw new AppError("Agreement not found.", 404, "NOT_FOUND");
  if (["signed", "declined", "expired"].includes(agreement.status)) {
    throw new AppError(
      `This agreement cannot be sent while its status is ${agreement.status}.`,
      409,
      "DOCUSIGN_AGREEMENT_NOT_SENDABLE",
    );
  }
  if (agreement.metadata?.docusignEnvelopeId || agreement.externalId) {
    throw new AppError(
      "This agreement already has a DocuSign envelope. Check its status instead of sending a duplicate.",
      409,
      "DOCUSIGN_ENVELOPE_ALREADY_EXISTS",
    );
  }
  const suppliedBase64 = String(req.body?.documentBase64 || "").replace(
    /\s+/g,
    "",
  );
  if (!suppliedBase64 || !/^[A-Za-z0-9+/=_-]+$/.test(suppliedBase64)) {
    throw new AppError(
      "documentBase64 is required. Provide the PDF file content encoded as Base64.",
      400,
      "DOCUSIGN_DOCUMENT_REQUIRED",
    );
  }
  const documentBase64 = suppliedBase64.replace(/-/g, "+").replace(/_/g, "/");
  let fileName = String(
    req.body?.fileName || `${agreement.name || "Banyan Agreement"}.pdf`,
  )
    .replace(/[\r\n]/g, " ")
    .slice(0, 100);
  if (!fileName.toLowerCase().endsWith(".pdf")) fileName = `${fileName}.pdf`;
  const fileExtension = "pdf";
  const signer = signerInfo(agreement, req.body || {});
  const result = await docusignRequest("POST", "/envelopes", {
    emailSubject: String(
      req.body?.emailSubject || `Please sign: ${agreement.name}`,
    ).slice(0, 200),
    status: "sent",
    documents: [
      { documentBase64, name: fileName, fileExtension, documentId: "1" },
    ],
    recipients: {
      signers: [
        {
          email: signer.email,
          name: signer.name,
          recipientId: "1",
          routingOrder: "1",
        },
      ],
    },
  });
  if (!result.envelopeId)
    throw new AppError(
      "DocuSign did not return an envelope ID.",
      502,
      "DOCUSIGN_ENVELOPE_ID_MISSING",
    );

  agreement.externalId = result.envelopeId;
  agreement.provider = "docusign";
  agreement.status = "sent";
  agreement.sentAt = new Date();
  agreement.metadata = {
    ...(agreement.metadata?.toObject
      ? agreement.metadata.toObject()
      : agreement.metadata || {}),
    docusignEnvelopeId: result.envelopeId,
    docusignStatus: result.status || "sent",
    recipientEmail: signer.email,
    docusignSentAt: new Date(),
  };
  await agreement.save();
  res.status(201).json({
    success: true,
    data: {
      agreementId: agreement._id,
      envelopeId: result.envelopeId,
      status: result.status || "sent",
      statusDateTime: result.statusDateTime || null,
    },
  });
});

export const getDocuSignAgreementStatus = asyncHandler(async (req, res) => {
  validateDocuSignConfiguration();
  const agreement = await Agreement.findOne({
    _id: req.params.agreementId,
    workspaceId: req.workspaceId,
  });
  if (!agreement) throw new AppError("Agreement not found.", 404, "NOT_FOUND");
  const envelopeId =
    agreement.metadata?.docusignEnvelopeId || agreement.externalId;
  if (!envelopeId)
    throw new AppError(
      "This agreement has not been sent through DocuSign.",
      404,
      "DOCUSIGN_ENVELOPE_NOT_FOUND",
    );

  const result = await docusignRequest(
    "GET",
    `/envelopes/${encodeURIComponent(envelopeId)}`,
  );
  const status = String(result.status || "").toLowerCase();
  if (status === "completed") {
    agreement.status = "signed";
    agreement.signedAt = result.completedDateTime
      ? new Date(result.completedDateTime)
      : new Date();
  } else if (status === "declined") {
    agreement.status = "declined";
  } else if (status === "voided") {
    agreement.status = "expired";
  } else if (status === "delivered") {
    agreement.status = "viewed";
    agreement.viewedAt = result.deliveredDateTime
      ? new Date(result.deliveredDateTime)
      : new Date();
  } else if (status === "sent") {
    agreement.status = "sent";
  }
  agreement.metadata = {
    ...(agreement.metadata?.toObject
      ? agreement.metadata.toObject()
      : agreement.metadata || {}),
    docusignEnvelopeId: envelopeId,
    docusignStatus: result.status || "unknown",
    docusignLastCheckedAt: new Date(),
  };
  await agreement.save();
  res.json({
    success: true,
    data: {
      agreementId: agreement._id,
      envelopeId,
      providerStatus: result.status,
      status: agreement.status,
      sentAt: agreement.sentAt,
      viewedAt: agreement.viewedAt,
      signedAt: agreement.signedAt,
    },
  });
});

export const getDocuSignConsentUrl = asyncHandler(async (req, res) => {
  requireEnvironment(
    "DOCUSIGN_INTEGRATION_KEY",
    "DOCUSIGN_OAUTH_BASE_URL",
    "PUBLIC_API_URL",
    "INTEGRATION_OAUTH_STATE_SECRET",
  );
  const base = String(env.PUBLIC_API_URL).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || parsed.origin !== base) {
    throw new AppError(
      "PUBLIC_API_URL must be the deployed HTTPS API origin.",
      503,
      "PUBLIC_API_URL_NOT_CONFIGURED",
    );
  }
  const redirectUri = `${base}/api/v1/integrations/docusign/callback`;
  const state = jwt.sign(
    {
      type: "integration_state",
      provider: "docusign",
      sub: String(req.user._id),
      workspaceId: String(req.workspaceId),
    },
    env.INTEGRATION_OAUTH_STATE_SECRET,
    {
      expiresIn: "10m",
      audience: "banyan-provider-integration",
      issuer: "banyan-crm",
    },
  );
  const params = new URLSearchParams({
    response_type: "code",
    scope: "signature impersonation",
    client_id: env.DOCUSIGN_INTEGRATION_KEY,
    redirect_uri: redirectUri,
    state,
  });
  res.json({
    success: true,
    data: {
      authorizationUrl: `${String(env.DOCUSIGN_OAUTH_BASE_URL).replace(/\/+$/, "")}/oauth/auth?${params.toString()}`,
      redirectUri,
    },
  });
});
