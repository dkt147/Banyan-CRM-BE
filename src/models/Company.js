import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200
    },

    legalName: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null
    },

    industry: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null
    },

    website: {
      type: String,
      trim: true,
      default: null
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },

    phone: {
      type: String,
      trim: true,
      default: null
    },

    address: {
      street: { type: String, trim: true, default: null },
      city: { type: String, trim: true, default: null },
      country: { type: String, trim: true, default: null },
      postalCode: { type: String, trim: true, default: null }
    },

    tags: [
      {
        type: String,
        trim: true
      }
    ],

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    notes: {
      type: String,
      trim: true,
      default: null
    },

    isArchived: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

companySchema.index({
  name: "text",
  legalName: "text"
});

export const Company = mongoose.model("Company", companySchema);