import { asyncHandler } from "../utils/asyncHandler.js";
import { Deal } from "../models/Deal.js";
import { Task } from "../models/Task.js";
import { Conversation } from "../models/Conversation.js";
import { Invoice } from "../models/Invoice.js";
import { Membership } from "../models/Membership.js";
import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
export const overview = asyncHandler(async (req, res) => {
  const w = req.workspaceId;
  const [pipeline, openDeals, tasks, unread, invoices, memberships, loyalty] =
    await Promise.all([
      Deal.aggregate([
        { $match: { workspaceId: w, status: "open" } },
        {
          $group: { _id: null, value: { $sum: "$value" }, count: { $sum: 1 } },
        },
      ]),
      Deal.countDocuments({ workspaceId: w, status: "open" }),
      Task.countDocuments({
        workspaceId: w,
        status: { $in: ["pending", "in_progress"] },
      }),
      Conversation.aggregate([
        { $match: { workspaceId: w, unreadCount: { $gt: 0 } } },
        { $group: { _id: null, count: { $sum: "$unreadCount" } } },
      ]),
      Invoice.aggregate([
        {
          $match: { workspaceId: w, status: { $in: ["awaiting", "overdue"] } },
        },
        {
          $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } },
        },
      ]),
      Membership.countDocuments({ workspaceId: w, status: "active" }),
      LoyaltyAccount.countDocuments({ workspaceId: w }),
    ]);
  res.json({
    success: true,
    data: {
      openPipeline: pipeline[0] || { value: 0, count: 0 },
      openDeals,
      tasksNeedingAction: tasks,
      unreadMessages: unread[0]?.count || 0,
      awaitingInvoices: invoices[0] || { total: 0, count: 0 },
      activeMemberships: memberships,
      enrolledLoyaltyClients: loyalty,
    },
  });
});
export const pipeline = asyncHandler(async (req, res) => {
  const rows = await Deal.aggregate([
    { $match: { workspaceId: req.workspaceId, status: "open" } },
    {
      $group: {
        _id: "$stageId",
        value: { $sum: "$value" },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "pipelinestages",
        localField: "_id",
        foreignField: "_id",
        as: "stage",
      },
    },
    { $unwind: "$stage" },
    {
      $project: {
        stageId: "$_id",
        name: "$stage.name",
        value: 1,
        count: 1,
        _id: 0,
      },
    },
    { $sort: { "stage.sortOrder": 1 } },
  ]);
  res.json({ success: true, data: rows });
});
export const revenue = asyncHandler(async (req, res) => {
  const rows = await Invoice.aggregate([
    { $match: { workspaceId: req.workspaceId, status: "paid" } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } },
        revenue: { $sum: "$total" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  res.json({ success: true, data: rows });
});
