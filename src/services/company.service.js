import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";

export async function createCompany(data) {
  console.log("[CREATE COMPANY SERVICE] data:", data);

  const company = await Company.create(data);

  return company;
}

export async function getCompanies({
  ownerId,
  workspaceId,
  page = 1,
  limit = 20,
  search,
  isArchived = false,
}) {
  const skip = (page - 1) * limit;

  const filter = {
    workspaceId,
    ownerId,
    isArchived,
  };

  if (search?.trim()) {
    filter.$text = {
      $search: search.trim(),
    };
  }

  const [companies, total] = await Promise.all([
    Company.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Company.countDocuments(filter),
  ]);

  return {
    companies,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getCompanyById(companyId, ownerId, workspaceId) {
  const company = await Company.findOne({
    _id: companyId,
    ownerId,
    workspaceId,
  });

  if (!company) {
    throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
  }

  return company;
}

export async function updateCompany(companyId, ownerId, data) {
  const company = await Company.findOneAndUpdate(
    {
      _id: companyId,
      ownerId,
    },
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!company) {
    throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
  }

  return company;
}

export async function archiveCompany(companyId, ownerId) {
  const company = await Company.findOneAndUpdate(
    {
      _id: companyId,
      ownerId,
    },
    {
      $set: {
        isArchived: true,
      },
    },
    {
      new: true,
    },
  );

  if (!company) {
    throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
  }

  return company;
}

export async function deleteCompany(companyId, ownerId) {
  const company = await Company.findOne({
    _id: companyId,
    ownerId,
  });

  if (!company) {
    throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
  }

  const [contactCount, dealCount] = await Promise.all([
    Contact.countDocuments({ companyId: company._id }),
    Deal.countDocuments({ companyId: company._id }),
  ]);

  if (contactCount > 0 || dealCount > 0) {
    throw new AppError(
      "Company cannot be deleted because it is linked to contacts or deals. Archive it instead.",
      409,
      "COMPANY_HAS_RELATIONS",
    );
  }

  await company.deleteOne();

  return {
    id: companyId,
    deleted: true,
  };
}
