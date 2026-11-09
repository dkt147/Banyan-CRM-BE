import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { auditAfter } from "../utils/audit.js";
import { validate } from "../middleware/validate.middleware.js";
import { automationRuleSchema } from "../validators/automation.validators.js";
import * as c from "../controllers/automation.controller.js";
const r = Router();
r.use(requireAuth);
r.get("/catalog", requirePermission("workflows.view"), c.catalog);
r.get("/", requirePermission("workflows.view"), c.list);
// Workflows/automations: Admin creates, edits, activates and runs; Sales views only;
// Read-only has no access (brief section 7). Every change is audited.
r.post("/", requirePermission("workflows.manage"), validate(automationRuleSchema), auditAfter("workflow.created", "automation_rule"), c.create);
r.patch("/:id", requirePermission("workflows.manage"), auditAfter("workflow.updated", "automation_rule"), c.update);
r.post("/:id/execute", requirePermission("workflows.manage"), auditAfter("workflow.run", "automation_rule", (d) => ({ executionId: d?._id, status: d?.status })), c.execute);
r.get("/:id/executions", requirePermission("workflows.view"), c.executions);
export default r;
