import bcrypt from "bcryptjs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
export const list = asyncHandler(async (req, res) => {
  const filter = { workspaceId: req.workspaceId };
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.isActive = req.query.status === "active";
  const rows = await User.find(filter)
    .select("-passwordHash")
    .sort({ name: 1 });
  res.json({ success: true, data: rows });
});
export const get = asyncHandler(async (req, res) => {
  const u = await User.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  }).select("-passwordHash");
  if (!u) throw new AppError("Member not found", 404, "NOT_FOUND");
  res.json({ success: true, data: u });
});
export const create = asyncHandler(async (req, res) => {
  if (!req.body.password)
    throw new AppError("Password is required", 400, "PASSWORD_REQUIRED");
  if (await User.findOne({ email: req.body.email }))
    throw new AppError("Email already exists", 409, "EMAIL_EXISTS");
  const u = await User.create({
    workspaceId: req.workspaceId,
    name: req.body.name,
    email: req.body.email,
    passwordHash: await bcrypt.hash(req.body.password, 12),
    role: req.body.role || "operator",
    phone: req.body.phone,
    jobTitle: req.body.jobTitle,
    avatarUrl: req.body.avatarUrl,
  });
  const out = u.toObject();
  delete out.passwordHash;
  res.status(201).json({ success: true, data: out });
});
export const update = asyncHandler(async (req, res) => {
  const allowed = [
    "name",
    "phone",
    "jobTitle",
    "avatarUrl",
    "role",
    "isActive",
    "preferences",
  ];
  const patch = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k)),
  );
  const u = await User.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    patch,
    { new: true, runValidators: true },
  ).select("-passwordHash");
  if (!u) throw new AppError("Member not found", 404, "NOT_FOUND");
  res.json({ success: true, data: u });
});
export const remove = asyncHandler(async (req, res) => {
  const u = await User.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { $set: { isActive: false } },
    { new: true },
  ).select("-passwordHash");
  if (!u) throw new AppError("Member not found", 404, "NOT_FOUND");
  res.json({ success: true, data: u });
});
