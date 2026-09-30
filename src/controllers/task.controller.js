import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  completeTask,
  snoozeTask,
  deleteTask,
} from "../services/task.service.js";

import {
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  snoozeTaskSchema,
  taskIdParamSchema,
  taskListQuerySchema,
} from "../validators/task.validators.js";


/**
 * Create Task
 * POST /tasks
 */
export const createTaskController = asyncHandler(async (req, res) => {
  const data = createTaskSchema.parse(req.body);

  const task = await createTask(data, req.user.id);

  return res.status(201).json({
    success: true,
    message: "Task created successfully.",
    data: task,
  });
});

/**
 * Get Tasks
 * GET /tasks
 */
export const getTasksController = asyncHandler(async (req, res) => {
  const query = taskListQuerySchema.parse(req.query);

  const result = await getTasks({
    ...query,
    ownerId: req.user.id,
  });

  return res.status(200).json({
    success: true,
    message: "Tasks fetched successfully.",
    data: result.tasks,
    pagination: result.pagination,
  });
});

/**
 * Get Task By ID
 * GET /tasks/:taskId
 */
export const getTaskController = asyncHandler(async (req, res) => {
  const { taskId } = taskIdParamSchema.parse(req.params);

  const task = await getTaskById(taskId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Task fetched successfully.",
    data: task,
  });
});

/**
 * Update Task
 * PATCH /tasks/:taskId
 */
export const updateTaskController = asyncHandler(async (req, res) => {
  const { taskId } = taskIdParamSchema.parse(req.params);

  const data = updateTaskSchema.parse(req.body);

  const task = await updateTask(taskId, req.user.id, data);

  return res.status(200).json({
    success: true,
    message: "Task updated successfully.",
    data: task,
  });
});

/**
 * Complete Task
 * PATCH /tasks/:taskId/complete
 */
export const completeTaskController = asyncHandler(async (req, res) => {
  const { taskId } = taskIdParamSchema.parse(req.params);

  // Validate that the endpoint does not receive
  // an unexpected body according to the existing schema.
  completeTaskSchema.parse(req.body || {});

  const task = await completeTask(taskId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Task completed successfully.",
    data: task,
  });
});

/**
 * Snooze Task
 * PATCH /tasks/:taskId/snooze
 */
export const snoozeTaskController = asyncHandler(async (req, res) => {
  const { taskId } = taskIdParamSchema.parse(req.params);

  const { snoozedUntil } = snoozeTaskSchema.parse(req.body);

  const task = await snoozeTask(
    taskId,
    req.user.id,
    snoozedUntil,
  );

  return res.status(200).json({
    success: true,
    message: "Task snoozed successfully.",
    data: task,
  });
});

/**
 * Delete Task
 * DELETE /tasks/:taskId
 */
export const deleteTaskController = asyncHandler(async (req, res) => {
  const { taskId } = taskIdParamSchema.parse(req.params);

  const result = await deleteTask(taskId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Task deleted successfully.",
    data: result,
  });
});

