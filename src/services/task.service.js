import { Task } from "../models/Task.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { Activity } from "../models/Activity.js";
import { Workspace } from "../models/Workspace.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex } from "../utils/phone.js";

const QUIET_DEAL_DAYS = 5;

function getZonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localMidnightAsUtc(calendarDate, timeZone) {
  const year = calendarDate.getUTCFullYear();
  const month = calendarDate.getUTCMonth();
  const day = calendarDate.getUTCDate();
  const target = Date.UTC(year, month, day, 0, 0, 0);
  let guess = target;

  // Iteratively apply the timezone offset so this also handles DST transitions.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = getZonedDateParts(new Date(guess), timeZone);
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const correction = target - representedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function getWorkspaceDateRanges(timeZone) {
  const now = new Date();
  const current = getZonedDateParts(now, timeZone);
  const todayCalendar = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const tomorrowCalendar = new Date(todayCalendar);
  tomorrowCalendar.setUTCDate(tomorrowCalendar.getUTCDate() + 1);

  // This week means the current Monday-to-Monday period, based on workspace timezone.
  const daysSinceMonday = (todayCalendar.getUTCDay() + 6) % 7;
  const nextMondayCalendar = new Date(todayCalendar);
  nextMondayCalendar.setUTCDate(nextMondayCalendar.getUTCDate() + (7 - daysSinceMonday));

  return {
    now,
    startOfToday: localMidnightAsUtc(todayCalendar, timeZone),
    startOfTomorrow: localMidnightAsUtc(tomorrowCalendar, timeZone),
    startOfNextWeek: localMidnightAsUtc(nextMondayCalendar, timeZone),
  };
}

export async function getTaskSummary({ ownerId, workspaceId }) {
  const workspace = await Workspace.findById(workspaceId).select("timezone").lean();
  let timeZone = workspace?.timezone || "Asia/Hong_Kong";
  try {
    // Validate stored timezone; malformed workspace configuration should not break Tasks.
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    timeZone = "Asia/Hong_Kong";
  }

  const { now, startOfToday, startOfTomorrow, startOfNextWeek } = getWorkspaceDateRanges(timeZone);
  const activeTaskFilter = {
    workspaceId,
    status: { $nin: ["completed", "cancelled"] },
    $and: [
      { $or: [{ createdBy: ownerId }, { assignedTo: ownerId }] },
      { $or: [{ status: { $ne: "snoozed" } }, { status: "snoozed", snoozedUntil: { $lte: now } }] },
    ],
  };
  const overdueFilter = {
    ...activeTaskFilter,
    dueAt: { $lt: startOfToday },
  };
  const dueTodayFilter = {
    ...activeTaskFilter,
    dueAt: { $gte: startOfToday, $lt: startOfTomorrow },
  };
  const thisWeekFilter = {
    ...activeTaskFilter,
    dueAt: { $gte: startOfToday, $lt: startOfNextWeek },
  };
  const quietCutoff = new Date(now.getTime() - QUIET_DEAL_DAYS * 24 * 60 * 60 * 1000);

  const [overdue, dueToday, thisWeek, dealsGoneQuiet] = await Promise.all([
    Task.countDocuments(overdueFilter),
    Task.countDocuments(dueTodayFilter),
    Task.countDocuments(thisWeekFilter),
    Deal.countDocuments({
      workspaceId,
      status: "open",
      $expr: {
        $lte: [
          { $ifNull: ["$lastActivityAt", { $ifNull: ["$updatedAt", "$createdAt"] }] },
          quietCutoff,
        ],
      },
    }),
  ]);

  return {
    overdue,
    dueToday,
    thisWeek,
    dealsGoneQuiet,
    quietDealThresholdDays: QUIET_DEAL_DAYS,
    timezone: timeZone,
  };
}

// Linked records must belong to the same workspace. They used to be checked against the
// current user as owner, which rejected links to a colleague's deal or contact (C2).
// When a deal is linked without a contact, the deal's contact/company are filled in so
// the task can always navigate to both.
async function validateRelations(data, workspaceId) {
  if (data.contactId) {
    const contact = await Contact.findOne({
      _id: data.contactId,
      workspaceId,
    });

    if (!contact) {
      throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
    }
  }

  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      workspaceId,
    });

    if (!company) {
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    }
  }

  if (data.dealId) {
    const deal = await Deal.findOne({
      _id: data.dealId,
      workspaceId,
    }).select("contactId companyId");

    if (!deal) {
      throw new AppError("Deal not found.", 404, "DEAL_NOT_FOUND");
    }

    if (!data.contactId && deal.contactId) data.contactId = deal.contactId;
    if (!data.companyId && deal.companyId) data.companyId = deal.companyId;
  }
}

const DEAL_POPULATE = {
  path: "dealId",
  select: "title value status currency dealNumber contactId companyId",
  populate: { path: "contactId", select: "firstName lastName email" },
};

export async function createTask(data, ownerId, workspaceId) {
  await validateRelations(data, workspaceId);

  const task = await Task.create({
    ...data,
    createdBy: ownerId,
    workspaceId,
    assignedTo: data.assignedTo || ownerId,
  });

  await Activity.create({
    type: "task_created",
    contactId: task.contactId,
    companyId: task.companyId,
    workspaceId: task.workspaceId,
    dealId: task.dealId,
    userId: ownerId,
    subject: "Task created",
    body: task.title,
    metadata: {
      taskId: task._id,
    },
  });

  return getTaskById(task._id, workspaceId);
}

export async function getTasks({
  ownerId,
  workspaceId,
  page = 1,
  limit = 20,
  status,
  priority,
  assignedTo,
  contactId,
  companyId,
  dealId,
  search,
  from,
  to,
}) {
  const skip = (page - 1) * limit;

  // Every role can view every task in the workspace (brief section 7, confirmed
  // 2026-11-10). Use the assignedTo filter for "my tasks".
  const filter = { workspaceId };

  if (status) {
    filter.status = status;
  }

  if (priority) {
    filter.priority = priority;
  }

  if (assignedTo) {
    filter.assignedTo = assignedTo;
  }

  if (contactId) {
    filter.contactId = contactId;
  }

  if (companyId) {
    filter.companyId = companyId;
  }

  if (dealId) {
    filter.dealId = dealId;
  }

  if (search) {
    const rx = { $regex: escapeRegex(search), $options: "i" };
    filter.$and = [{ $or: [{ title: rx }, { description: rx }] }];
  }

  if (from || to) {
    filter.dueAt = {};

    if (from) {
      filter.dueAt.$gte = new Date(from);
    }

    if (to) {
      filter.dueAt.$lte = new Date(to);
    }
  }

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .populate("assignedTo", "name email role")
      .populate("createdBy", "name email role")
      .populate("contactId", "firstName lastName email")
      .populate("companyId", "name")
      .populate(DEAL_POPULATE)
      .sort({
        dueAt: 1,
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit),

    Task.countDocuments(filter),
  ]);

  return {
    tasks,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getTaskById(taskId, workspaceId) {
  const task = await Task.findOne({
    _id: taskId,
    workspaceId,
  })
    .populate("assignedTo", "name email role")
    .populate("createdBy", "name email role")
    .populate("contactId", "firstName lastName email phone")
    .populate("companyId", "name")
    .populate(DEAL_POPULATE);

  if (!task) {
    throw new AppError("Task not found.", 404, "TASK_NOT_FOUND");
  }

  return task;
}

export async function updateTask(taskId, workspaceId, data) {
  const task = await Task.findOne({
    _id: taskId,
    workspaceId,
  });

  if (!task) {
    throw new AppError("Task not found.", 404, "TASK_NOT_FOUND");
  }

  // Only validate links that this update changes; clearing a link stays allowed.
  await validateRelations(data, task.workspaceId);

  if (data.status === "completed" && task.status !== "completed") {
    data.completedAt = new Date();
  }

  if (data.status && data.status !== "completed") {
    data.completedAt = null;
  }

  const updatedTask = await Task.findByIdAndUpdate(
    taskId,
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  return getTaskById(updatedTask._id, workspaceId);
}

export async function completeTask(taskId, workspaceId) {
  return updateTask(taskId, workspaceId, {
    status: "completed",
    completedAt: new Date(),
  });
}

export async function snoozeTask(taskId, workspaceId, snoozedUntil) {
  if (!snoozedUntil) {
    throw new AppError(
      "snoozedUntil is required.",
      400,
      "SNOOZE_DATE_REQUIRED",
    );
  }

  const date = new Date(snoozedUntil);

  if (Number.isNaN(date.getTime())) {
    throw new AppError("Invalid snooze date.", 400, "INVALID_SNOOZE_DATE");
  }

  return updateTask(taskId, workspaceId, {
    status: "snoozed",
    snoozedUntil: date,
  });
}

export async function deleteTask(taskId, workspaceId) {
  const task = await Task.findOne({
    _id: taskId,
    workspaceId,
  });

  if (!task) {
    throw new AppError("Task not found.", 404, "TASK_NOT_FOUND");
  }

  await task.deleteOne();

  return {
    id: taskId,
    deleted: true,
  };
}
