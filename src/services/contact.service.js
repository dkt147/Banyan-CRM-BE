import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";

export async function createContact(data, ownerId) {
  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      ownerId,
    });

    if (!company) {
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    }
  }

  const contact = await Contact.create({
    ...data,
    ownerId,
  });

  return contact;
}

export async function getContacts({
  ownerId,
  page = 1,
  limit = 20,
  search,
  companyId,
  isArchived = false,
}) {
  const skip = (page - 1) * limit;

  const filter = {
    ownerId,
    isArchived,
  };

  if (companyId) {
    filter.companyId = companyId;
  }

  if (search?.trim()) {
    filter.$text = {
      $search: search.trim(),
    };
  }

  const [contacts, total] = await Promise.all([
    Contact.find(filter)
      .populate("companyId", "name industry")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Contact.countDocuments(filter),
  ]);

  return {
    contacts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getContactById(contactId, ownerId) {
  const contact = await Contact.findOne({
    _id: contactId,
    ownerId,
  }).populate("companyId", "name industry website");

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  return contact;
}

export async function updateContact(contactId, ownerId, data) {
  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      ownerId,
    });

    if (!company) {
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    }
  }

  const contact = await Contact.findOneAndUpdate(
    {
      _id: contactId,
      ownerId,
    },
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    },
  ).populate("companyId", "name industry");

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  return contact;
}

export async function archiveContact(contactId, ownerId) {
  const contact = await Contact.findOneAndUpdate(
    {
      _id: contactId,
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

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  return contact;
}

export async function deleteContact(contactId, ownerId) {
  const contact = await Contact.findOne({
    _id: contactId,
    ownerId,
  });

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  const dealCount = await Deal.countDocuments({
    contactId: contact._id,
  });

  if (dealCount > 0) {
    throw new AppError(
      "Contact cannot be deleted because it is linked to deals. Archive it instead.",
      409,
      "CONTACT_HAS_RELATIONS",
    );
  }

  await contact.deleteOne();

  return {
    id: contactId,
    deleted: true,
  };
}
