import bcrypt from "bcryptjs";
import { connectDatabase } from "../config/database.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { LoyaltyTier } from "../models/LoyaltyTier.js";
import { Template } from "../models/Template.js";
await connectDatabase();
let user = await User.findOne({ email: "admin@banyan.local" });
let workspace = user ? await Workspace.findById(user.workspaceId) : null;
if (!workspace) {
  workspace = new Workspace({
    name: "Banyan Workspace",
    slug: "banyan-workspace",
    timezone: "Asia/Hong_Kong",
    currency: "HKD",
  });


  await workspace.save({ validateBeforeSave: false });

  user = await User.create({
    workspaceId: workspace._id,
    name: "Banyan Admin",
    email: "admin@banyan.local",
    passwordHash: await bcrypt.hash("ChangeMe123!", 12),
    role: "admin",
  });

  workspace.createdBy = user._id;
  await workspace.save();
}
const pipelines = [
  [
    "Membership",
    [
      "Enquiry",
      "Template sent",
      "Trial day booked",
      "Trial completed",
      "Agreement sent",
      "Deposit paid",
      "Active",
    ],
  ],
  [
    "Private office",
    [
      "Enquiry",
      "Viewing",
      "Quote",
      "Negotiation",
      "Agreement signed",
      "Deposit collected",
      "Move-in",
    ],
  ],
  ["Venue hire", ["Enquiry", "Quote", "Agreement", "Deposit"]],
  ["Transactional", ["Booking received", "Confirmed", "Completed"]],
];
for (const [name, stages] of pipelines) {
  let p = await Pipeline.findOne({
    workspaceId: workspace._id,
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  });
  if (!p)
    p = await Pipeline.create({
      workspaceId: workspace._id,
      name,
      key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ownerId: user._id,
    });
  for (let i = 0; i < stages.length; i++) {
    await PipelineStage.updateOne(
      {
        workspaceId: workspace._id,
        pipelineId: p._id,
        key: stages[i].toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      },
      {
        $setOnInsert: {
          workspaceId: workspace._id,
          pipelineId: p._id,
          name: stages[i],
          key: stages[i].toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          sortOrder: i,
          probability: Math.min(i * 15, 90),
          isClosedWon: i === stages.length - 1,
        },
      },
      { upsert: true },
    );
  }
}
const tiers = [
  [
    "Bronze",
    0,
    99999,
    0.05,
    ["5% off venue hire", "Priority on provisional holds"],
  ],
  [
    "Silver",
    100000,
    249999,
    0.1,
    ["10% off venue hire", "Two free meeting room hours a quarter"],
  ],
  [
    "Gold",
    250000,
    499999,
    0.15,
    [
      "15% off venue hire",
      "Free AV and coordinator",
      "One complimentary studio half-day a year",
    ],
  ],
  [
    "Platinum",
    500000,
    null,
    0.2,
    [
      "20% off venue hire",
      "First refusal on peak dates",
      "Named account contact",
    ],
  ],
];
for (let i = 0; i < tiers.length; i++) {
  const [name, min, max, discount, benefits] = tiers[i];
  await LoyaltyTier.updateOne(
    { workspaceId: workspace._id, name },
    {
      $set: {
        minSpend: min,
        maxSpend: max,
        discountPercent: discount * 100,
        benefits,
        sortOrder: i,
        isActive: true,
      },
    },
    { upsert: true },
  );
}
console.log(`Seed complete. Admin: admin@banyan.local / ChangeMe123!`);
process.exit(0);
