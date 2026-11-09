import bcrypt from "bcryptjs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { ROLES } from "../utils/permissions.js";
import { writeAudit } from "../utils/audit.js";

function assertRole(role) {
  if (role !== undefined && !ROLES.includes(role))
    throw new AppError(`Role must be one of: ${ROLES.join(", ")}.`, 400, "INVALID_ROLE");
}

// A workspace must always keep at least one active admin.
async function assertNotLastAdmin(workspaceId, userId) {
  const others = await User.countDocuments({ workspaceId, role: "admin", isActive: true, _id: { $ne: userId } });
  if (!others) throw new AppError("The workspace must keep at least one active admin.", 409, "LAST_ADMIN");
}
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
  assertRole(req.body.role);
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
  await writeAudit(req, { action: "user.created", entityType: "user", entityId: u._id, after: { email: u.email, role: u.role } });
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
  assertRole(patch.role);
  const before = await User.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).select("role isActive").lean();
  if (!before) throw new AppError("Member not found", 404, "NOT_FOUND");
  const losingAdmin = before.role === "admin" && ((patch.role && patch.role !== "admin") || patch.isActive === false);
  if (losingAdmin) await assertNotLastAdmin(req.workspaceId, before._id);
  const u = await User.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    patch,
    { new: true, runValidators: true },
  ).select("-passwordHash");
  if (!u) throw new AppError("Member not found", 404, "NOT_FOUND");
  if (before.role !== u.role || before.isActive !== u.isActive)
    await writeAudit(req, {
      action: before.role !== u.role ? "user.role_changed" : "user.status_changed",
      entityType: "user", entityId: u._id,
      before: { role: before.role, isActive: before.isActive },
      after: { role: u.role, isActive: u.isActive },
    });
  res.json({ success: true, data: u });
});
export const remove = asyncHandler(async (req, res) => {
  const target = await User.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).select("role isActive").lean();
  if (!target) throw new AppError("Member not found", 404, "NOT_FOUND");
  if (target.role === "admin") await assertNotLastAdmin(req.workspaceId, target._id);
  const u = await User.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { $set: { isActive: false } },
    { new: true },
  ).select("-passwordHash");
  if (!u) throw new AppError("Member not found", 404, "NOT_FOUND");
  if (target.isActive !== false)
    await writeAudit(req, { action: "user.deactivated", entityType: "user", entityId: u._id, before: { isActive: true }, after: { isActive: false } });
  res.json({ success: true, data: u });
});
