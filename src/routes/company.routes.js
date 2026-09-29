import { Router } from "express";

import { requireAuth } from "../middleware/auth.middleware.js";

import {
  createCompanyController,
  getCompaniesController,
  getCompanyController,
  updateCompanyController,
  archiveCompanyController,
  deleteCompanyController,
} from "../controllers/company.controller.js";

const router = Router();

router.use(requireAuth);

router.post("/", createCompanyController);

router.get("/", getCompaniesController);

router.get("/:companyId", getCompanyController);

router.patch("/:companyId", updateCompanyController);

router.patch("/:companyId/archive", archiveCompanyController);

router.delete("/:companyId", deleteCompanyController);

export default router;
