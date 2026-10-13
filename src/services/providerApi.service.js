import { env } from "../config/env.js";
import { Integration } from "../models/Integration.js";
import { AppError } from "../utils/AppError.js";
import {
  decryptIntegrationToken,
  encryptIntegrationToken,
} from "../utils/integrationTokens.js";

export async function providerJson(url, options = {}, provider = "Provider") {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const providerMessage =
      data?.Message ||
      data?.message ||
      data?.error_description ||
      data?.error?.message;
    const safeMessage =
      typeof providerMessage === "string"
        ? providerMessage.replace(/[\r\n]/g, " ").slice(0, 240)
        : `${provider} returned HTTP ${response.status}`;
    throw new AppError(
      `${provider} API request failed (${response.status}): ${safeMessage}`,
      502,
      `${String(provider)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")}_API_ERROR`,
    );
  }
  return data;
}

export async function getConnectedIntegration(workspaceId, provider) {
  const integration = await Integration.findOne({
    workspaceId,
    provider,
    status: "connected",
  });
  if (!integration || !integration.accessTokenEncrypted) {
    throw new AppError(
      `${provider} is not connected. Complete the provider authorization flow first.`,
      409,
      "INTEGRATION_NOT_CONNECTED",
    );
  }
  return integration;
}

function integrationExpiry(config) {
  const value = config?.expiresAt;
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function refreshProviderToken(integration, provider) {
  const refreshToken = decryptIntegrationToken(
    integration.refreshTokenEncrypted,
  );
  if (!refreshToken) {
    throw new AppError(
      `${provider} access token expired and no refresh token is stored. Reconnect the account.`,
      409,
      "INTEGRATION_REAUTH_REQUIRED",
    );
  }

  let response;
  if (provider === "xero") {
    if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
      throw new AppError(
        "XERO_CLIENT_ID and XERO_CLIENT_SECRET are required to refresh the Xero token.",
        503,
        "XERO_NOT_CONFIGURED",
      );
    }
    const basic = Buffer.from(
      `${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`,
    ).toString("base64");
    response = await providerJson(
      "https://identity.xero.com/connect/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      },
      "Xero OAuth",
    );
  } else if (provider === "gmail" || provider === "google_calendar") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required to refresh the Google token.",
        503,
        "GOOGLE_NOT_CONFIGURED",
      );
    }
    response = await providerJson(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      },
      "Google OAuth",
    );
  } else {
    throw new AppError(
      `Automatic token refresh is not supported for ${provider}.`,
      500,
      "TOKEN_REFRESH_UNSUPPORTED",
    );
  }

  if (!response.access_token) {
    throw new AppError(
      `${provider} did not return a refreshed access token.`,
      502,
      "REFRESH_TOKEN_MISSING",
    );
  }

  const expiresAt = response.expires_in
    ? new Date(Date.now() + Number(response.expires_in) * 1000)
    : null;
  const set = {
    accessTokenEncrypted: encryptIntegrationToken(response.access_token),
    status: "connected",
    error: undefined,
  };
  if (response.refresh_token) {
    set.refreshTokenEncrypted = encryptIntegrationToken(response.refresh_token);
  }
  const configUpdate = {
    "config.tokenType": response.token_type || "Bearer",
    "config.expiresAt": expiresAt,
    "config.scope": response.scope || integration.config?.scope || "",
  };

  if (provider === "gmail" || provider === "google_calendar") {
    // Gmail and Calendar share the same Google OAuth grant, so keep both provider records in sync.
    const providers = ["gmail", "google_calendar"];
    for (const linkedProvider of providers) {
      const update = { ...set, ...configUpdate };
      await Integration.updateOne(
        { workspaceId: integration.workspaceId, provider: linkedProvider },
        { $set: update },
      );
    }
  } else {
    await Integration.updateOne(
      { _id: integration._id },
      { $set: { ...set, ...configUpdate } },
    );
  }

  return response.access_token;
}

export async function getProviderAccessToken(workspaceId, provider) {
  const integration = await getConnectedIntegration(workspaceId, provider);
  const expiresAt = integrationExpiry(integration.config);
  const token = decryptIntegrationToken(integration.accessTokenEncrypted);
  if (token && expiresAt > Date.now() + 60_000) return token;
  if (token && !expiresAt && !integration.refreshTokenEncrypted) return token;
  return refreshProviderToken(integration, provider);
}

export function requireEnvironment(...names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new AppError(
      `Integration environment configuration is incomplete: ${missing.join(", ")}.`,
      503,
      "INTEGRATION_NOT_CONFIGURED",
    );
  }
}

export function isoDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}
