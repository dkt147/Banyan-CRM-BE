import { Task } from "../models/Task.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { Activity } from "../models/Activity.js";
import { AppError } from "../utils/AppError.js";

async function validateRelations(data, ownerId) {
  if (data.contactId) {
    const contact = await Contact.findOne({
      _id: data.contactId,
      ownerId,
    });

    if (!contact) {
      throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
    }
  }

  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      ownerId,
    });

    if (!company) {
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    }
  }

  if (data.dealId) {
    const deal = await Deal.findOne({
      _id: data.dealId,
      ownerId,
    });

    if (!deal) {
      throw new AppError("Deal not found.", 404, "DEAL_NOT_FOUND");
    }
  }
}

export async function createTask(data, ownerId, workspaceId) {
  await validateRelations(data, ownerId);

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

  return getTaskById(task._id, ownerId);
}

export async function getTasks({
  ownerId,
  page = 1,
  limit = 20,
  status,
  priority,
  assignedTo,
  contactId,
  companyId,
  dealId,
  from,
  to,
}) {
  const skip = (page - 1) * limit;

  const filter = {};

  /*
   * A user can see:
   * - tasks they created
   * - tasks assigned to them
   *
   * This prevents unrelated users' tasks from leaking.
   */
  filter.$or = [{ createdBy: ownerId }, { assignedTo: ownerId }];

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
      .populate("dealId", "title value status")
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

export async function getTaskById(taskId, ownerId) {
  const task = await Task.findOne({
    _id: taskId,
    $or: [{ createdBy: ownerId }, { assignedTo: ownerId }],
  })
    .populate("assignedTo", "name email role")
    .populate("createdBy", "name email role")
    .populate("contactId", "firstName lastName email phone")
    .populate("companyId", "name")
    .populate("dealId", "title value status");

  if (!task) {
    throw new AppError("Task not found.", 404, "TASK_NOT_FOUND");
  }

  return task;
}

export async function updateTask(taskId, ownerId, data) {
  const task = await Task.findOne({
    _id: taskId,
    $or: [{ createdBy: ownerId }, { assignedTo: ownerId }],
  });

  if (!task) {
    throw new AppError("Task not found.", 404, "TASK_NOT_FOUND");
  }

  await validateRelations(data, ownerId);

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

  return getTaskById(updatedTask._id, ownerId);
}

export async function completeTask(taskId, ownerId) {
  return updateTask(taskId, ownerId, {
    status: "completed",
    completedAt: new Date(),
  });
}

export async function snoozeTask(taskId, ownerId, snoozedUntil) {
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

  return updateTask(taskId, ownerId, {
    status: "snoozed",
    snoozedUntil: date,
  });
}

export async function deleteTask(taskId, ownerId) {
  const task = await Task.findOne({
    _id: taskId,
    $or: [{ createdBy: ownerId }, { assignedTo: ownerId }],
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
