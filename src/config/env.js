import "dotenv/config";

const required = ["MONGODB_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required in .env`);
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number(process.env.PORT || 5000),
  MONGODB_URI: process.env.MONGODB_URI,
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",
  PUBLIC_WEBSITE_URL: process.env.PUBLIC_WEBSITE_URL || "https://banyanworkspace.com",
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || "",
  PUBLIC_ENQUIRY_WORKSPACE_ID: process.env.PUBLIC_ENQUIRY_WORKSPACE_ID || "",
  PUBLIC_ENQUIRY_WORKSPACE_SLUG: process.env.PUBLIC_ENQUIRY_WORKSPACE_SLUG || "banyan-workspace",
  TRUST_PROXY_HOPS: Math.max(0, Number(process.env.TRUST_PROXY_HOPS || 0)),
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || "30d",
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE || "lax",
  // Public HTTPS API origin, without the /api/v1 suffix.
  PUBLIC_API_URL: (process.env.PUBLIC_API_URL || "").replace(/\/+$/, ""),
  INTEGRATION_TOKEN_ENCRYPTION_KEY:
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "",
  INTEGRATION_OAUTH_STATE_SECRET:
    process.env.INTEGRATION_OAUTH_STATE_SECRET || "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  XERO_CLIENT_ID: process.env.XERO_CLIENT_ID || "",
  XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET || "",
  XERO_TENANT_ID: process.env.XERO_TENANT_ID || "",
  XERO_SALES_ACCOUNT_CODE: process.env.XERO_SALES_ACCOUNT_CODE || "",
  XERO_DEFAULT_TAX_TYPE: process.env.XERO_DEFAULT_TAX_TYPE || "",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "primary",
  GOOGLE_CALENDAR_TIMEZONE: process.env.GOOGLE_CALENDAR_TIMEZONE || "UTC",
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "",
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  WHATSAPP_WORKSPACE_ID: process.env.WHATSAPP_WORKSPACE_ID || "",
  META_APP_ID: process.env.META_APP_ID || "",
  META_APP_SECRET: process.env.META_APP_SECRET || "",
  META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION || "v26.0",
  DOCUSIGN_INTEGRATION_KEY: process.env.DOCUSIGN_INTEGRATION_KEY || "",
  DOCUSIGN_USER_ID: process.env.DOCUSIGN_USER_ID || "",
  DOCUSIGN_ACCOUNT_ID: process.env.DOCUSIGN_ACCOUNT_ID || "",
  DOCUSIGN_BASE_URI: process.env.DOCUSIGN_BASE_URI || "",
  DOCUSIGN_OAUTH_BASE_URL:
    process.env.DOCUSIGN_OAUTH_BASE_URL || "https://account-d.docusign.com",
  DOCUSIGN_RSA_PRIVATE_KEY: process.env.DOCUSIGN_RSA_PRIVATE_KEY || "",
};
