import { Activity } from "../models/Activity.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";

async function validateRelations(data, userId) {
  if (data.contactId) {
    const contact = await Contact.findOne({
      _id: data.contactId,
      ownerId: userId
    });

    if (!contact) {
      throw new AppError(
        "Contact not found.",
        404,
        "CONTACT_NOT_FOUND"
      );
    }
  }

  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      ownerId: userId
    });

    if (!company) {
      throw new AppError(
        "Company not found.",
        404,
        "COMPANY_NOT_FOUND"
      );
    }
  }

  if (data.dealId) {
    const deal = await Deal.findOne({
      _id: data.dealId,
      ownerId: userId
    });

    if (!deal) {
      throw new AppError(
        "Deal not found.",
        404,
        "DEAL_NOT_FOUND"
      );
    }
  }
}

export async function createActivity(
  data,
  userId
) {
  await validateRelations(data, userId);

  const activity = await Activity.create({
    ...data,
    userId
  });

  if (data.dealId) {
    await Deal.updateOne(
      {
        _id: data.dealId,
        ownerId: userId
      },
      {
        $set: {
          lastActivityAt:
            data.occurredAt || new Date()
        }
      }
    );
  }

  return activity;
}

export async function getActivities({
  userId,
  contactId,
  companyId,
  dealId,
  type,
  page = 1,
  limit = 50
}) {
  const skip = (page - 1) * limit;

  const filter = {
    userId
  };

  if (contactId) {
    filter.contactId = contactId;
  }

  if (companyId) {
    filter.companyId = companyId;
  }

  if (dealId) {
    filter.dealId = dealId;
  }

  if (type) {
    filter.type = type;
  }

  const [activities, total] = await Promise.all([
    Activity.find(filter)
      .populate(
        "contactId",
        "firstName lastName email phone"
      )
      .populate("companyId", "name")
      .populate("dealId", "title value status")
      .populate("userId", "name email")
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit),

    Activity.countDocuments(filter)
  ]);

  return {
    activities,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

export async function getActivityById(
  activityId,
  userId
) {
  const activity = await Activity.findOne({
    _id: activityId,
    userId
  })
    .populate(
      "contactId",
      "firstName lastName email phone"
    )
    .populate("companyId", "name")
    .populate("dealId", "title value status")
    .populate("userId", "name email");

  if (!activity) {
    throw new AppError(
      "Activity not found.",
      404,
      "ACTIVITY_NOT_FOUND"
    );
  }

  return activity;
}

export async function deleteActivity(
  activityId,
  userId
) {
  const activity = await Activity.findOne({
    _id: activityId,
    userId
  });

  if (!activity) {
    throw new AppError(
      "Activity not found.",
      404,
      "ACTIVITY_NOT_FOUND"
    );
  }

  await activity.deleteOne();

  return {
    id: activityId,
    deleted: true
  };
}