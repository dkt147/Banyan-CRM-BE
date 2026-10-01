import {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  archiveCompany,
  deleteCompany,
} from "../services/company.service.js";

import {
  createCompanySchema,
  updateCompanySchema,
  companyIdParamSchema,
  companyListQuerySchema,
} from "../validators/company.validators.js";

export async function createCompanyController(req, res) {
  console.log("[CREATE COMPANY] req.user:", req.user);

  const data = createCompanySchema.parse(req.body);

  const company = await createCompany({
    ...data,
    ownerId: req.user._id,
    workspaceId: req.user.workspaceId,
  });

  return res.status(201).json({
    success: true,
    message: "Company created successfully.",
    data: company,
  });
}

export async function getCompaniesController(req, res) {
  const query = companyListQuerySchema.parse(req.query);

  const result = await getCompanies({
    ...query,
    ownerId: req.user._id,
    workspaceId: req.user.workspaceId,
  });

  return res.status(200).json({
    success: true,
    message: "Companies fetched successfully.",
    data: result.companies,
    pagination: result.pagination,
  });
}

export async function getCompanyController(req, res) {
  const { companyId } = companyIdParamSchema.parse(req.params);

  const company = await getCompanyById(
    companyId,
    req.user._id,
    req.user.workspaceId,
  );

  return res.status(200).json({
    success: true,
    message: "Company fetched successfully.",
    data: company,
  });
}

export async function updateCompanyController(req, res) {
  const { companyId } = companyIdParamSchema.parse(req.params);

  const data = updateCompanySchema.parse(req.body);

  const company = await updateCompany(companyId, req.user.id, data);

  return res.status(200).json({
    success: true,
    message: "Company updated successfully.",
    data: company,
  });
}

export async function archiveCompanyController(req, res) {
  const { companyId } = companyIdParamSchema.parse(req.params);

  const company = await archiveCompany(companyId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Company archived successfully.",
    data: company,
  });
}

export async function deleteCompanyController(req, res) {
  const { companyId } = companyIdParamSchema.parse(req.params);

  const result = await deleteCompany(companyId, req.user.id);

  return res.status(200).json({
    success: true,
    message: "Company deleted successfully.",
    data: result,
  });
}
