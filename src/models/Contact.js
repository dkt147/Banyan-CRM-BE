import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },

    lastName: {
      type: String,
      trim: true,
      maxlength: 100,
      default: ""
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      index: true
    },

    phone: {
      type: String,
      trim: true,
      default: null
    },

    whatsapp: {
      type: String,
      trim: true,
      default: null
    },

    jobTitle: {
      type: String,
      trim: true,
      default: null
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true
    },

    tags: [
      {
        type: String,
        enum: [
          "prospect",
          "active_member",
          "past_member",
          "event_client",
          "broker_agent",
          "ngo",
          "vip"
        ]
      }
    ],

    source: {
      type: String,
      trim: true,
      default: null
    },

    language: {
      type: String,
      trim: true,
      default: "en"
    },

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

contactSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

contactSchema.set("toJSON", {
  virtuals: true
});

contactSchema.index({
  firstName: "text",
  lastName: "text",
  email: "text"
});

export const Contact = mongoose.model("Contact", contactSchema);