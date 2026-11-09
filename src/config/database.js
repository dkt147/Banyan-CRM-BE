import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  // MONGODB_AUTO_INDEX=false stops the app from building indexes on startup, so schema
  // changes happen only through `npm run migrate` (recommended for production).
  await mongoose.connect(env.MONGODB_URI, { autoIndex: env.MONGODB_AUTO_INDEX });
  console.log("MongoDB connected");
}
