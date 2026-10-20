import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createTaskController,
  getTasksController,
  getTaskController,
  updateTaskController,
  completeTaskController,
  snoozeTaskController,
  deleteTaskController,
  getTaskSummaryController,
} from "../controllers/task.controller.js";

const router = Router();
router.use(requireAuth);
router.post("/", createTaskController);
router.get("/", getTasksController);
router.get("/summary", getTaskSummaryController);
router.get("/:taskId", getTaskController);
router.patch("/:taskId", updateTaskController);
router.patch("/:taskId/complete", completeTaskController);
router.patch("/:taskId/snooze", snoozeTaskController);
router.delete("/:taskId", deleteTaskController);
export default router;
