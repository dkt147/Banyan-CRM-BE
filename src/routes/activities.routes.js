import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createActivityController,
  getActivitiesController,
  getActivityController,
  deleteActivityController,
} from "../controllers/activity.controller.js";

const router = Router();
router.use(requireAuth);
router.post("/", createActivityController);
router.get("/", getActivitiesController);
router.get("/:activityId", getActivityController);
router.delete("/:activityId", deleteActivityController);
export default router;
