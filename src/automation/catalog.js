// Single source of truth for the automation builder.
// The frontend mirrors these lists in src/pages/Automation.jsx — keep them in sync.
// Pure module: no database or framework imports, so it can be unit-tested directly.

export const DAY_MS = 86400000;

export const TRIGGERS = {
  deal_created: { label: "Deal created", timeBased: false },
  deal_updated: { label: "Deal updated", timeBased: false },
  deal_stage_changed: { label: "Deal stage changed", timeBased: false },
  deal_status_changed: { label: "Deal won / lost / reopened", timeBased: false },
  // Checked by the scheduler, not by an event. Needs a daysInactive or daysInStage condition.
  deal_inactive: { label: "Deal inactive (checked every 15 min)", timeBased: true },
};

export const TIME_BASED_TRIGGERS = Object.keys(TRIGGERS).filter((k) => TRIGGERS[k].timeBased);

// Field types drive which operators are allowed and how values are compared.
export const DEAL_FIELDS = {
  title: { label: "Deal title", type: "text" },
  productType: { label: "Product type", type: "text" },
  source: { label: "Lead source", type: "text" },
  status: { label: "Status (open / won / lost)", type: "text" },
  currency: { label: "Currency", type: "text" },
  value: { label: "Deal value", type: "number" },
  recurringValue: { label: "Recurring value", type: "number" },
  stageId: { label: "Stage ID", type: "id" },
  pipelineId: { label: "Pipeline ID", type: "id" },
  ownerId: { label: "Owner ID", type: "id" },
  daysInStage: { label: "Days in current stage", type: "number" },
  daysInactive: { label: "Days since last activity", type: "number" },
  ageDays: { label: "Days since created", type: "number" },
};

export const OPERATORS_BY_TYPE = {
  text: ["equals", "not_equals", "contains", "not_contains", "exists", "not_exists"],
  id: ["equals", "not_equals", "exists", "not_exists"],
  number: ["equals", "not_equals", "greater_than", "less_than", "exists", "not_exists"],
};

export const OPERATOR_LABELS = {
  equals: "Equals",
  not_equals: "Not equals",
  contains: "Contains",
  not_contains: "Does not contain",
  greater_than: "Greater than",
  less_than: "Less than",
  exists: "Exists",
  not_exists: "Does not exist",
};

export const ACTION_TYPES = ["create_task", "log_activity", "notify", "change_stage"];

// Special assignee values; anything else must be a workspace user ObjectId.
export const ASSIGNEE_DEALS_OWNER = "deal_owner";
export const ASSIGNEE_RULE_CREATOR = "creator";

export function operatorAllowed(fieldKey, operator) {
  const field = DEAL_FIELDS[fieldKey];
  return Boolean(field) && OPERATORS_BY_TYPE[field.type].includes(operator);
}

export function operatorNeedsValue(operator) {
  return operator !== "exists" && operator !== "not_exists";
}

// Derive every value a condition may test from a deal document (mongoose doc or lean object).
export function buildDealFacts(deal, now = new Date()) {
  const d = typeof deal?.toObject === "function" ? deal.toObject() : deal || {};
  const str = (v) => (v === null || v === undefined ? "" : String(v));
  const num = (v) => (v === null || v === undefined || v === "" ? "" : Number(v));
  const daysBetween = (from) => {
    if (!from) return "";
    return Math.max(0, Math.round(((now.getTime() - new Date(from).getTime()) / DAY_MS) * 100) / 100);
  };
  const lastActive = d.lastActivityAt || d.updatedAt || d.createdAt;
  return {
    title: str(d.title),
    productType: str(d.productType),
    source: str(d.source),
    status: str(d.status),
    currency: str(d.currency),
    value: num(d.value ?? 0),
    recurringValue: num(d.recurringValue ?? 0),
    stageId: str(d.stageId),
    pipelineId: str(d.pipelineId),
    ownerId: str(d.ownerId),
    daysInStage: daysBetween(d.stageChangedAt || d.createdAt),
    daysInactive: daysBetween(lastActive),
    ageDays: daysBetween(d.createdAt),
  };
}

function isEmpty(v) {
  return v === "" || v === null || v === undefined;
}

// Returns true only when every condition holds. An empty list matches everything.
export function evaluateConditions(conditions, facts) {
  return (conditions || []).every((c) => {
    const type = DEAL_FIELDS[c.field]?.type || "text";
    const actual = facts[c.field];
    if (c.operator === "exists") return !isEmpty(actual);
    if (c.operator === "not_exists") return isEmpty(actual);
    if (type === "number") {
      const a = Number(actual);
      const e = Number(c.value);
      if (isEmpty(actual) || Number.isNaN(a) || Number.isNaN(e)) return false;
      if (c.operator === "equals") return a === e;
      if (c.operator === "not_equals") return a !== e;
      if (c.operator === "greater_than") return a > e;
      if (c.operator === "less_than") return a < e;
      return false;
    }
    const a = String(actual ?? "").toLowerCase();
    const e = String(c.value ?? "").toLowerCase();
    if (c.operator === "equals") return a === e;
    if (c.operator === "not_equals") return a !== e;
    if (c.operator === "contains") return a.includes(e);
    if (c.operator === "not_contains") return !a.includes(e);
    return false;
  });
}
