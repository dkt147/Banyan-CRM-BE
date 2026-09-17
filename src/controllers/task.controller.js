import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  completeTask,
  snoozeTask,
  deleteTask
} from "../services/task.service.js";

import {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  snoozeTaskSchema,
  taskIdParamSchema,
  taskListQuerySchema
} from "../validators/task.validators.js";

export async function createTaskController(
  req,
  res
) {
  const data = createTaskSchema.parse(req.body);

  const task = await createTask(
    data,
    req.user.id
  );

  return res.status(201).json({
    success: true,
    message: "Task created successfully.",
    data: task
  });
}

export async function getTasksController(
  req,
  res
) {
  const query = taskListQuerySchema.parse(req.query);

  const result = await getTasks({
    ...query,
    ownerId: req.user.id
  });

  return res.status(200).json({
    success: true,
    message: "Tasks fetched successfully.",
    data: result.tasks,
    pagination: result.pagination
  });
}

export async function getTaskController(
  req,
  res
) {
  const { taskId } =
    taskIdParamSchema.parse(req.params);

  const task = await getTaskById(
    taskId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Task fetched successfully.",
    data: task
  });
}

export async function updateTaskController(
  req,
  res
) {
  const { taskId } =
    taskIdParamSchema.parse(req.params);

  const data = updateTaskSchema.parse(req.body);

  const task = await updateTask(
    taskId,
    req.user.id,
    data
  );

  return res.status(200).json({
    success: true,
    message: "Task updated successfully.",
    data: task
  });
}

export async function completeTaskController(
  req,
  res
) {
  const { taskId } =
    taskIdParamSchema.parse(req.params);

  completeTaskSchema.parse(req.body);

  const task = await completeTask(
    taskId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Task completed successfully.",
    data: task
  });
}

export async function snoozeTaskController(
  req,
  res
) {
  const { taskId } =
    taskIdParamSchema.parse(req.params);

  const { snoozedUntil } =
    snoozeTaskSchema.parse(req.body);

  const task = await snoozeTask(
    taskId,
    req.user.id,
    snoozedUntil
  );

  return res.status(200).json({
    success: true,
    message: "Task snoozed successfully.",
    data: task
  });
}

export async function deleteTaskController(
  req,
  res
) {
  const { taskId } =
    taskIdParamSchema.parse(req.params);

  const result = await deleteTask(
    taskId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Task deleted successfully.",
    data: result
  });
}