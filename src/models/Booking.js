import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    resourceName: String,
    bookingType: String,
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["held", "pending", "confirmed", "completed", "cancelled"],
      default: "held",
      index: true,
    },
    holdExpiresAt: Date,
    price: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, startAt: 1, endAt: 1 });
export const Booking = mongoose.model("Booking", schema);
