import { asyncHandler } from "../utils/asyncHandler.js";
import { Notification } from "../models/Notification.js";
export const list = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await Notification.find({
      workspaceId: req.workspaceId,
      userId: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(Math.min(+req.query.limit || 50, 100)),
  }),
);
export const read = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        workspaceId: req.workspaceId,
        userId: req.user._id,
      },
      { readAt: new Date() },
      { new: true },
    ),
  }),
);
export const readAll = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { workspaceId: req.workspaceId, userId: req.user._id, readAt: null },
    { $set: { readAt: new Date() } },
  );
  res.json({ success: true });
});
