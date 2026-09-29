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
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || "30d",
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE || "lax",
};
