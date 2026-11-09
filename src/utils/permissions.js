/*
 * Roles and permissions (Developer Brief v2.1, section 7).
 *
 * Stored roles map to the brief's three roles (decision 2026-11-10):
 *   admin              -> Admin
 *   manager, operator  -> Sales
 *   read_only          -> Read-only
 * Stored values are unchanged, so no user data migration is needed.
 *
 * Read-only users can view records but cannot create, edit or delete anything; that
 * is enforced centrally in requireAuth (see READ_ONLY_ALLOWED_WRITES).
 */
export const ROLES = ["admin", "manager", "operator", "read_only"];

const GROUP = { admin: "admin", manager: "sales", operator: "sales", read_only: "read_only" };
export const roleGroup = (role) => GROUP[role] || "read_only";

// permission -> brief roles allowed
export const PERMISSIONS = {
  "records.write": ["admin", "sales"], // create and edit records
  "bookings.write": ["admin", "sales"], // create and cancel bookings
  "bookings.refund": ["admin"],
  "resources.manage": ["admin"], // rooms, opening hours and pricing
  "workflows.view": ["admin", "sales"], // Sales: view only
  "workflows.manage": ["admin"], // create, edit, activate, run
  "segments.use": ["admin", "sales"],
  "segments.manage": ["admin"],
  "forms.manage": ["admin"],
  "templates.use": ["admin", "sales"],
  "templates.manage": ["admin"],
  "data.export": ["admin"],
  "users.manage": ["admin"],
  "workspace.manage": ["admin"],
};

export function can(user, permission) {
  const allowed = PERMISSIONS[permission];
  return Boolean(user && allowed && allowed.includes(roleGroup(user.role)));
}

// Writes a Read-only user may still make: their own profile/saved views, marking
// notifications read, and asking the (read-only) assistant.
export const READ_ONLY_ALLOWED_WRITES = [
  /^\/api\/v1\/auth\/profile$/,
  /^\/api\/v1\/notifications\/(read-all|[^/]+\/read)$/,
  /^\/api\/v1\/assistant\/chat$/,
];
