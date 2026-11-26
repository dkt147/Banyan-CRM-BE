import mongoose from "mongoose";

/* Events read from Eventbrite (27 Nov b, A). Eventbrite stays the source of truth; nothing is written back. */
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    source: { type: String, default: "eventbrite" },
    externalId: { type: String, required: true },
    name: { type: String, default: "" },
    description: { type: String, maxlength: 5000, default: "" },
    url: { type: String, default: null },
    status: { type: String, default: "live" }, // draft | live | started | ended | completed | canceled
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    timezone: { type: String, default: null },
    venue: { type: String, default: null },
    capacity: { type: Number, default: null },
    isFree: { type: Boolean, default: false },
    currency: { type: String, default: null },
    registrationCount: { type: Number, default: 0 },
    checkedInCount: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, source: 1, externalId: 1 }, { unique: true });
schema.index({ workspaceId: 1, startAt: -1 });
export const Event = mongoose.model("Event", schema);
