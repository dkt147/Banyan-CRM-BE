import mongoose from "mongoose";
// A Google Calendar push-notification (watch) channel, for the later sync phase that
// replaces polling. Phase 1 only defines the storage.
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    integrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Integration", index: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Resource", index: true },
    calendarId: { type: String, required: true },
    channelId: { type: String, required: true },
    googleResourceId: String,
    resourceUri: String,
    // Stored hashed; the raw token is only sent to Google when the channel is created.
    tokenHash: String,
    syncToken: String,
    expiresAt: { type: Date, index: true },
    status: { type: String, enum: ["active", "stopped", "expired", "error"], default: "active", index: true },
    lastMessageNumber: Number,
    lastNotifiedAt: Date,
    error: String,
  },
  { timestamps: true },
);
schema.index({ channelId: 1 }, { unique: true });
schema.index({ workspaceId: 1, calendarId: 1, status: 1 });
export const GoogleCalendarChannel = mongoose.model("GoogleCalendarChannel", schema);
