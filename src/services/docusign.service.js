import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { providerJson, requireEnvironment } from "./providerApi.service.js";

let cachedToken = null;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function privateKey() {
  return String(env.DOCUSIGN_RSA_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
}

function docusignApiBase() {
  const configured = String(env.DOCUSIGN_BASE_URI || "").replace(/\/+$/, "");
  if (!configured)
    throw new AppError(
      "DOCUSIGN_BASE_URI is required.",
      503,
      "DOCUSIGN_NOT_CONFIGURED",
    );
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") throw new Error("https required");
  } catch {
    throw new AppError(
      "DOCUSIGN_BASE_URI must be an HTTPS base URI supplied by DocuSign.",
      503,
      "DOCUSIGN_BASE_URI_INVALID",
    );
  }
  return configured.endsWith("/restapi") ? configured : `${configured}/restapi`;
}

export async function getDocuSignAccessToken() {
  requireEnvironment(
    "DOCUSIGN_INTEGRATION_KEY",
    "DOCUSIGN_USER_ID",
    "DOCUSIGN_RSA_PRIVATE_KEY",
    "DOCUSIGN_OAUTH_BASE_URL",
  );
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
    return cachedToken.accessToken;

  const key = privateKey();
  if (
    !key.includes("BEGIN PRIVATE KEY") &&
    !key.includes("BEGIN RSA PRIVATE KEY")
  ) {
    throw new AppError(
      "DOCUSIGN_RSA_PRIVATE_KEY must contain the PEM private key generated for the DocuSign integration.",
      503,
      "DOCUSIGN_PRIVATE_KEY_INVALID",
    );
  }
  let oauthHost;
  try {
    const oauthUrl = new URL(env.DOCUSIGN_OAUTH_BASE_URL);
    if (oauthUrl.protocol !== "https:") throw new Error("https required");
    oauthHost = oauthUrl.hostname;
  } catch {
    throw new AppError(
      "DOCUSIGN_OAUTH_BASE_URL must be a valid HTTPS URL.",
      503,
      "DOCUSIGN_OAUTH_BASE_URL_INVALID",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: env.DOCUSIGN_INTEGRATION_KEY,
    sub: env.DOCUSIGN_USER_ID,
    aud: oauthHost,
    iat: now - 60,
    exp: now + 3600,
    scope: "signature impersonation",
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  let signature;
  try {
    signature = crypto
      .sign("RSA-SHA256", Buffer.from(unsigned), key)
      .toString("base64url");
  } catch {
    throw new AppError(
      "DocuSign private key could not be used to sign the JWT assertion.",
      503,
      "DOCUSIGN_PRIVATE_KEY_INVALID",
    );
  }
  const assertion = `${unsigned}.${signature}`;
  const token = await providerJson(
    `${String(env.DOCUSIGN_OAUTH_BASE_URL).replace(/\/+$/, "")}/oauth/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
    "DocuSign OAuth",
  );
  if (!token.access_token)
    throw new AppError(
      "DocuSign did not return an access token.",
      502,
      "DOCUSIGN_TOKEN_MISSING",
    );
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

export async function docusignRequest(method, path, body) {
  requireEnvironment("DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_BASE_URI");
  const token = await getDocuSignAccessToken();
  const base = docusignApiBase();
  return providerJson(
    `${base}/v2.1/accounts/${encodeURIComponent(env.DOCUSIGN_ACCOUNT_ID)}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    "DocuSign",
  );
}

export function validateDocuSignConfiguration() {
  requireEnvironment(
    "DOCUSIGN_INTEGRATION_KEY",
    "DOCUSIGN_USER_ID",
    "DOCUSIGN_ACCOUNT_ID",
    "DOCUSIGN_BASE_URI",
    "DOCUSIGN_RSA_PRIVATE_KEY",
    "DOCUSIGN_OAUTH_BASE_URL",
  );
}
