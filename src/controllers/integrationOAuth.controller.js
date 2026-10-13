import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { Integration } from "../models/Integration.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  assertIntegrationEncryptionConfigured,
  encryptIntegrationToken,
} from "../utils/integrationTokens.js";

const OAUTH_AUDIENCE = "banyan-provider-integration";
const OAUTH_ISSUER = "banyan-crm";
const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "offline_access",
];
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function publicApiUrl() {
  const base = (env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  let validOrigin = false;
  try {
    const parsed = new URL(base);
    validOrigin = parsed.protocol === "https:" && parsed.origin === base;
  } catch {
    validOrigin = false;
  }
  if (!validOrigin) {
    throw new AppError(
      "PUBLIC_API_URL must be set to the deployed HTTPS API origin without a path.",
      503,
      "PUBLIC_API_URL_NOT_CONFIGURED",
    );
  }
  return base;
}

function callbackUri(provider) {
  const paths = {
    xero: "/api/v1/integrations/xero/callback",
    google: "/api/v1/integrations/google/callback",
    docusign: "/api/v1/integrations/docusign/callback",
  };
  return `${publicApiUrl()}${paths[provider]}`;
}

function requiredEnv(...names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new AppError(
      `Integration configuration is incomplete: ${missing.join(", ")}.`,
      503,
      "INTEGRATION_NOT_CONFIGURED",
    );
  }
}

function createOAuthState(user, provider) {
  return jwt.sign(
    {
      type: "integration_state",
      provider,
      sub: String(user._id),
      workspaceId: String(user.workspaceId),
    },
    env.INTEGRATION_OAUTH_STATE_SECRET,
    {
      expiresIn: "10m",
      audience: OAUTH_AUDIENCE,
      issuer: OAUTH_ISSUER,
    },
  );
}

function verifyOAuthState(value, expectedProvider) {
  if (!value || typeof value !== "string") {
    throw new AppError("OAuth state is missing.", 400, "INVALID_OAUTH_STATE");
  }
  let state;
  try {
    state = jwt.verify(value, env.INTEGRATION_OAUTH_STATE_SECRET, {
      audience: OAUTH_AUDIENCE,
      issuer: OAUTH_ISSUER,
    });
  } catch {
    throw new AppError(
      "OAuth state is invalid or expired.",
      400,
      "INVALID_OAUTH_STATE",
    );
  }
  if (
    state.type !== "integration_state" ||
    state.provider !== expectedProvider ||
    !state.sub ||
    !state.workspaceId
  ) {
    throw new AppError(
      "OAuth state does not match this integration.",
      400,
      "INVALID_OAUTH_STATE",
    );
  }
  return state;
}

function callbackPage(res, success, title, message) {
  const statusCode = success ? 200 : 400;
  const safeTitle = success ? title : "Connection not completed";
  const safeMessage = success
    ? message
    : "Authorization could not be completed. Return to Banyan and check the integration configuration, then try again.";
  res
    .status(statusCode)
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{font:16px system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:24px;color:#1f2937}main{border:1px solid #e5e7eb;border-radius:12px;padding:28px}h1{font-size:1.4rem}p{line-height:1.6}</style></head><body><main><h1>${safeTitle}</h1><p>${safeMessage}</p><p>You may close this window and return to Banyan.</p></main></body></html>`,
    );
}

async function responseJson(response, provider, action) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`${provider} ${action} failed with HTTP ${response.status}.`);
    throw new AppError(
      `${provider} authorization could not be completed. Check the app credentials, redirect URI, and requested scopes.`,
      502,
      `${provider.toUpperCase()}_OAUTH_FAILED`,
    );
  }
  return body;
}

async function saveIntegration({
  workspaceId,
  userId,
  provider,
  accountName,
  externalAccountId,
  tokens,
  config = {},
}) {
  const set = {
    status: "connected",
    accountName: accountName || provider,
    externalAccountId: externalAccountId || "",
    accessTokenEncrypted: encryptIntegrationToken(tokens.access_token),
    config: {
      ...config,
      tokenType: tokens.token_type || "Bearer",
      scope: tokens.scope || config.scope || "",
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000)
        : null,
      connectedAt: new Date(),
    },
  };
  if (tokens.refresh_token) {
    set.refreshTokenEncrypted = encryptIntegrationToken(tokens.refresh_token);
  }

  return Integration.findOneAndUpdate(
    { workspaceId, provider },
    {
      $set: set,
      $unset: { error: 1 },
      $setOnInsert: { workspaceId, provider, connectedBy: userId },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

export const callbackUrls = (_req, res) => {
  const base = (env.PUBLIC_API_URL || "").replace(/\/+$/, "");
  let isHttpsOrigin = false;
  try {
    const parsed = new URL(base);
    isHttpsOrigin = parsed.protocol === "https:" && parsed.origin === base;
  } catch {
    isHttpsOrigin = false;
  }
  const url = (path) => (isHttpsOrigin ? `${base}${path}` : null);
  res.json({
    success: true,
    data: {
      publicApiUrlConfigured: isHttpsOrigin,
      stripeWebhookUrl: url("/api/v1/webhooks/stripe"),
      xeroRedirectUri: url("/api/v1/integrations/xero/callback"),
      googleRedirectUri: url("/api/v1/integrations/google/callback"),
      whatsappWebhookUrl: url("/api/v1/webhooks/whatsapp"),
      docusignRedirectUri: url("/api/v1/integrations/docusign/callback"),
    },
  });
};

export const startXeroConnect = asyncHandler(async (req, res) => {
  requiredEnv(
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "INTEGRATION_OAUTH_STATE_SECRET",
  );
  assertIntegrationEncryptionConfigured();
  const redirectUri = callbackUri("xero");
  const state = createOAuthState(req.user, "xero");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.XERO_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES.join(" "),
    state,
  });
  res.json({
    success: true,
    data: {
      authorizationUrl: `https://login.xero.com/identity/connect/authorize?${params.toString()}`,
      redirectUri,
      expiresInSeconds: 600,
    },
  });
});

export const xeroCallback = asyncHandler(async (req, res) => {
  if (req.query.error) {
    return callbackPage(
      res,
      false,
      "Xero authorization cancelled",
      "Xero authorization was cancelled or denied.",
    );
  }
  requiredEnv(
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "INTEGRATION_OAUTH_STATE_SECRET",
  );
  assertIntegrationEncryptionConfigured();
  if (!req.query.code)
    throw new AppError(
      "Xero authorization code is missing.",
      400,
      "OAUTH_CODE_REQUIRED",
    );
  const state = verifyOAuthState(req.query.state, "xero");
  const redirectUri = callbackUri("xero");
  const basic = Buffer.from(
    `${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`,
  ).toString("base64");
  const tokenResponse = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: redirectUri,
    }),
  });
  const tokens = await responseJson(tokenResponse, "Xero", "token exchange");
  if (!tokens.access_token)
    throw new AppError(
      "Xero did not return an access token.",
      502,
      "XERO_TOKEN_MISSING",
    );

  const connectionsResponse = await fetch("https://api.xero.com/connections", {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/json",
    },
  });
  const connections = await responseJson(
    connectionsResponse,
    "Xero",
    "organisation lookup",
  );
  const tenants = Array.isArray(connections) ? connections : [];
  const tenant = env.XERO_TENANT_ID
    ? tenants.find((item) => item.tenantId === env.XERO_TENANT_ID)
    : tenants.length === 1
      ? tenants[0]
      : null;
  if (!tenant?.tenantId) {
    const message =
      tenants.length > 1
        ? "More than one Xero organisation is connected. Set XERO_TENANT_ID to the intended tenant and retry the connection."
        : "No Xero organisation was selected or connected to this account.";
    throw new AppError(message, 400, "XERO_TENANT_NOT_FOUND");
  }

  await saveIntegration({
    workspaceId: state.workspaceId,
    userId: state.sub,
    provider: "xero",
    accountName: tenant.tenantName || "Xero organisation",
    externalAccountId: tenant.tenantId,
    tokens,
    config: {
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName || "",
      tenantType: tenant.tenantType || "",
      scope: XERO_SCOPES.join(" "),
    },
  });
  return callbackPage(
    res,
    true,
    "Xero connected",
    "Your Xero organisation has been connected to Banyan.",
  );
});

export const startGoogleConnect = asyncHandler(async (req, res) => {
  requiredEnv(
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "INTEGRATION_OAUTH_STATE_SECRET",
  );
  assertIntegrationEncryptionConfigured();
  const redirectUri = callbackUri("google");
  const state = createOAuthState(req.user, "google");
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  res.json({
    success: true,
    data: {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
      scopes: GOOGLE_SCOPES,
      expiresInSeconds: 600,
    },
  });
});

export const googleCallback = asyncHandler(async (req, res) => {
  if (req.query.error) {
    return callbackPage(
      res,
      false,
      "Google authorization cancelled",
      "Google authorization was cancelled or denied.",
    );
  }
  requiredEnv(
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "INTEGRATION_OAUTH_STATE_SECRET",
  );
  assertIntegrationEncryptionConfigured();
  if (!req.query.code)
    throw new AppError(
      "Google authorization code is missing.",
      400,
      "OAUTH_CODE_REQUIRED",
    );
  const state = verifyOAuthState(req.query.state, "google");
  const redirectUri = callbackUri("google");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code: String(req.query.code),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await responseJson(tokenResponse, "Google", "token exchange");
  if (!tokens.access_token)
    throw new AppError(
      "Google did not return an access token.",
      502,
      "GOOGLE_TOKEN_MISSING",
    );

  const userInfoResponse = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
      },
    },
  );
  const userInfo = await responseJson(
    userInfoResponse,
    "Google",
    "account lookup",
  );
  const accountName = userInfo.email || "Google account";
  const config = {
    googleAccountId: userInfo.id || "",
    email: userInfo.email || "",
    scopes: GOOGLE_SCOPES,
    scope: tokens.scope || GOOGLE_SCOPES.join(" "),
  };
  await Promise.all([
    saveIntegration({
      workspaceId: state.workspaceId,
      userId: state.sub,
      provider: "gmail",
      accountName,
      externalAccountId: userInfo.id || userInfo.email || "",
      tokens,
      config: { ...config, purpose: "gmail" },
    }),
    saveIntegration({
      workspaceId: state.workspaceId,
      userId: state.sub,
      provider: "google_calendar",
      accountName,
      externalAccountId: userInfo.id || userInfo.email || "",
      tokens,
      config: { ...config, purpose: "google_calendar" },
    }),
  ]);
  return callbackPage(
    res,
    true,
    "Google connected",
    "Google Workspace and Calendar authorization has been saved to Banyan.",
  );
});

export const docusignCallback = (req, res) => {
  if (req.query.error || !req.query.code) {
    return callbackPage(
      res,
      false,
      "DocuSign consent not completed",
      "DocuSign did not return a consent confirmation. Return to Banyan and retry the consent step.",
    );
  }
  verifyOAuthState(req.query.state, "docusign");
  return callbackPage(
    res,
    true,
    "DocuSign consent received",
    "DocuSign consent was received. The backend can now use the configured JWT grant to request API access.",
  );
};
