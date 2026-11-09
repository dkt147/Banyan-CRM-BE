import { AuditLog } from "../models/AuditLog.js";

/*
 * Audit trail (brief section 7): role changes, consent changes, refunds, exports and
 * workflow activation/edits must be logged. Failures never block the user's action.
 */
export async function writeAudit(req, { action, entityType, entityId, before, after, reason }) {
  try {
    await AuditLog.create({
      workspaceId: req.workspaceId,
      actorId: req.user?._id,
      action,
      entityType,
      entityId,
      before,
      after,
      reason,
      ipAddress: req.ip,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    });
  } catch (error) {
    console.error("[audit] could not write audit log:", error.message);
  }
}

/** Route middleware: writes an audit entry after a successful JSON response. */
export function auditAfter(action, entityType, pick = (data) => data) {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400 && body?.success !== false) {
        const data = body?.data;
        writeAudit(req, { action, entityType, entityId: data?._id || req.params.id, after: data ? pick(data) : undefined });
      }
      return json(body);
    };
    next();
  };
}
