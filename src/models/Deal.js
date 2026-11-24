import mongoose from "mongoose";
import { Sequence } from "./Sequence.js";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    dealNumber: { type: Number, index: true, min: 1000 },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true,
    },
    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PipelineStage",
      required: true,
      index: true,
    },
    value: { type: Number, min: 0, default: 0 },
    recurringValue: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "HKD", uppercase: true },
    productType: { type: String, default: "other" },
    source: String,
    expectedCloseDate: Date,
    membershipStartAt: Date,
    membershipEndAt: Date,
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "won", "lost"],
      default: "open",
      index: true,
    },
    lostReason: String,
    description: String,
    lastActivityAt: Date,
    nextActionAt: Date,
    stageChangedAt: Date,
    // When the deal was won or lost (null while open). Maintained by the hooks below; used by reports.
    closedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, dealNumber: 1 }, { unique: true, sparse: true });
schema.pre("validate", async function assignDealNumber() {
  if (!this.isNew || this.dealNumber != null) return;
  const key = `deal:${this.workspaceId}`;
  const sequence = await Sequence.findOneAndUpdate(
    { key }, { $inc: { value: 1 }, $setOnInsert: { key } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  // Start readable IDs at 3333 while keeping them unique within each workspace.
  this.dealNumber = 3332 + sequence.value;
});
// closedAt: set when status becomes won/lost, cleared when reopened.
const CLOSED = ["won", "lost"];
schema.pre("save", function setClosedAt() {
  if (this.isNew) {
    if (CLOSED.includes(this.status) && !this.closedAt) this.closedAt = new Date();
    return;
  }
  if (this.isModified("status")) this.closedAt = CLOSED.includes(this.status) ? new Date() : null;
});
// Query updates (updateOne/updateMany/findOneAndUpdate) that set status: fix closedAt on the
// matched deals afterwards, only where it is missing or stale, so repeating "won" keeps the date.
function statusFromUpdate(update = {}) {
  return update.$set?.status ?? update.status;
}
function rememberStatusUpdate() {
  const status = statusFromUpdate(this.getUpdate());
  this._closedAtSync = status ? { status, filter: this.getFilter() } : null;
}
async function syncClosedAt() {
  const sync = this._closedAtSync;
  if (!sync) return;
  const Model = this.model;
  if (CLOSED.includes(sync.status))
    await Model.updateMany({ ...sync.filter, status: sync.status, closedAt: null }, { $set: { closedAt: new Date() } });
  else await Model.updateMany({ ...sync.filter, status: "open", closedAt: { $ne: null } }, { $set: { closedAt: null } });
}
for (const op of ["updateOne", "updateMany", "findOneAndUpdate"]) {
  schema.pre(op, rememberStatusUpdate);
  schema.post(op, syncClosedAt);
}
schema.index({ workspaceId: 1, pipelineId: 1, stageId: 1, status: 1 });
schema.index({ workspaceId: 1, status: 1, closedAt: 1 });
schema.index({ workspaceId: 1, createdAt: -1 });
// One deal per paid Stripe Checkout Session (website day passes, services/dayPassPurchase.service.js).
schema.index(
  { workspaceId: 1, "metadata.stripeCheckoutSessionId": 1 },
  { unique: true, partialFilterExpression: { "metadata.stripeCheckoutSessionId": { $type: "string" } } },
);
schema.index({ title: "text", source: "text" });
export const Deal = mongoose.model("Deal", schema);
