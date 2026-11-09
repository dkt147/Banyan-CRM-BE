import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex } from "../utils/phone.js";

// Companies are workspace records (same as contacts and deals), so a company linked
// from a contact, deal or booking opens for every CRM user in the workspace.

export async function createCompany(data) {

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
  sort = "createdAt",
  order = "desc",
}) {
  const skip = (page - 1) * limit;

  const filter = {
    workspaceId,
    ...(isArchived === null ? {} : { isArchived }),
  };

  if (search?.trim()) {
    const rx = { $regex: escapeRegex(search.trim()), $options: "i" };
    filter.$or = [{ name: rx }, { legalName: rx }, { email: rx }];
  }

  const [companies, total] = await Promise.all([
    Company.find(filter)
      .sort({ [sort === "name" ? "name" : "createdAt"]: order === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(limit),

    Company.countDocuments(filter),
  ]);

  const ids = companies.map((c) => c._id);
  const [contactRows, dealRows] = ids.length
    ? await Promise.all([
        Contact.aggregate([{ $match: { workspaceId, companyId: { $in: ids }, isArchived: false } }, { $group: { _id: "$companyId", n: { $sum: 1 } } }]),
        Deal.aggregate([{ $match: { workspaceId, companyId: { $in: ids }, status: "open" } }, { $group: { _id: "$companyId", n: { $sum: 1 } } }]),
      ])
    : [[], []];
  const contactCounts = new Map(contactRows.map((r) => [String(r._id), r.n]));
  const dealCounts = new Map(dealRows.map((r) => [String(r._id), r.n]));

  return {
    companies: companies.map((c) => ({
      ...c.toJSON(),
      contactCount: contactCounts.get(String(c._id)) || 0,
      openDealCount: dealCounts.get(String(c._id)) || 0,
    })),
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
    workspaceId,
  });

  if (!company) {
    throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
  }

  return company;
}

export async function updateCompany(companyId, workspaceId, data) {
  const company = await Company.findOneAndUpdate(
    {
      _id: companyId,
      workspaceId,
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

export async function archiveCompany(companyId, workspaceId) {
  const company = await Company.findOneAndUpdate(
    {
      _id: companyId,
      workspaceId,
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

export async function deleteCompany(companyId, workspaceId) {
  const company = await Company.findOne({
    _id: companyId,
    workspaceId,
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
