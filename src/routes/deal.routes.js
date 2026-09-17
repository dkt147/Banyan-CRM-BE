import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import {
  createDealController,
  getDealsController,
  getDealController,
  updateDealController,
  moveDealController,
  deleteDealController
} from "../controllers/deal.controller.js";

const router = Router();

router.use(requireAuth);

router.post(
  "/",
  createDealController
);

router.get(
  "/",
  getDealsController
);

router.get(
  "/:dealId",
  getDealController
);

router.patch(
  "/:dealId",
  updateDealController
);

router.patch(
  "/:dealId/move",
  moveDealController
);

router.delete(
  "/:dealId",
  deleteDealController
);

export default router;