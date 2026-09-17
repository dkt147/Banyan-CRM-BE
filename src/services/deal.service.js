import { Deal } from "../models/Deal.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Activity } from "../models/Activity.js";
import { AppError } from "../utils/AppError.js";

async function validateDealRelations(data, ownerId) {
  const contact = await Contact.findOne({
    _id: data.contactId,
    ownerId
  });

  if (!contact) {
    throw new AppError(
      "Contact not found.",
      404,
      "CONTACT_NOT_FOUND"
    );
  }

  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      ownerId
    });

    if (!company) {
      throw new AppError(
        "Company not found.",
        404,
        "COMPANY_NOT_FOUND"
      );
    }
  }

  const pipeline = await Pipeline.findOne({
    _id: data.pipelineId,
    ownerId,
    isActive: true
  });

  if (!pipeline) {
    throw new AppError(
      "Pipeline not found.",
      404,
      "PIPELINE_NOT_FOUND"
    );
  }

  const stage = await PipelineStage.findOne({
    _id: data.stageId,
    pipelineId: pipeline._id,
    isActive: true
  });

  if (!stage) {
    throw new AppError(
      "Pipeline stage does not belong to the selected pipeline.",
      400,
      "INVALID_PIPELINE_STAGE"
    );
  }

  return {
    contact,
    pipeline,
    stage
  };
}

export async function createDeal(data, ownerId) {
  const { stage } = await validateDealRelations(
    data,
    ownerId
  );

  let status = data.status || "open";

  if (stage.isClosedWon) {
    status = "won";
  }

  if (stage.isClosedLost) {
    status = "lost";
  }

  const deal = await Deal.create({
    ...data,
    status,
    ownerId,
    lastActivityAt: new Date()
  });

  await Activity.create({
    type: "deal_created",
    contactId: deal.contactId,
    companyId: deal.companyId,
    dealId: deal._id,
    userId: ownerId,
    subject: "Deal created",
    body: `Deal "${deal.title}" was created.`
  });

  return getDealById(deal._id, ownerId);
}

export async function getDeals({
  ownerId,
  page = 1,
  limit = 20,
  search,
  pipelineId,
  stageId,
  status,
  contactId,
  companyId
}) {
  const skip = (page - 1) * limit;

  const filter = {
    ownerId
  };

  if (pipelineId) {
    filter.pipelineId = pipelineId;
  }

  if (stageId) {
    filter.stageId = stageId;
  }

  if (status) {
    filter.status = status;
  }

  if (contactId) {
    filter.contactId = contactId;
  }

  if (companyId) {
    filter.companyId = companyId;
  }

  if (search?.trim()) {
    filter.$text = {
      $search: search.trim()
    };
  }

  const [deals, total] = await Promise.all([
    Deal.find(filter)
      .populate("contactId", "firstName lastName email phone")
      .populate("companyId", "name")
      .populate("pipelineId", "name key")
      .populate(
        "stageId",
        "name key sortOrder probability"
      )
      .populate("ownerId", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Deal.countDocuments(filter)
  ]);

  return {
    deals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

export async function getDealById(dealId, ownerId) {
  const deal = await Deal.findOne({
    _id: dealId,
    ownerId
  })
    .populate(
      "contactId",
      "firstName lastName email phone whatsapp"
    )
    .populate("companyId", "name industry website")
    .populate("pipelineId", "name key")
    .populate(
      "stageId",
      "name key sortOrder probability isClosedWon isClosedLost"
    )
    .populate("ownerId", "name email");

  if (!deal) {
    throw new AppError(
      "Deal not found.",
      404,
      "DEAL_NOT_FOUND"
    );
  }

  return deal;
}

export async function updateDeal(
  dealId,
  ownerId,
  data
) {
  const currentDeal = await Deal.findOne({
    _id: dealId,
    ownerId
  });

  if (!currentDeal) {
    throw new AppError(
      "Deal not found.",
      404,
      "DEAL_NOT_FOUND"
    );
  }

  const nextData = {
    ...data
  };

  if (
    data.contactId ||
    data.companyId ||
    data.pipelineId ||
    data.stageId
  ) {
    await validateDealRelations(
      {
        contactId:
          data.contactId ?? currentDeal.contactId,
        companyId:
          data.companyId ?? currentDeal.companyId,
        pipelineId:
          data.pipelineId ?? currentDeal.pipelineId,
        stageId:
          data.stageId ?? currentDeal.stageId
      },
      ownerId
    );
  }

  if (data.stageId) {
    const stage = await PipelineStage.findById(
      data.stageId
    );

    if (stage?.isClosedWon) {
      nextData.status = "won";
    } else if (stage?.isClosedLost) {
      nextData.status = "lost";
    } else if (!data.status) {
      nextData.status = "open";
    }
  }

  const stageChanged =
    data.stageId &&
    data.stageId.toString() !==
      currentDeal.stageId.toString();

  const deal = await Deal.findOneAndUpdate(
    {
      _id: dealId,
      ownerId
    },
    {
      $set: {
        ...nextData,
        lastActivityAt: new Date()
      }
    },
    {
      new: true,
      runValidators: true
    }
  );

  if (stageChanged) {
    await Activity.create({
      type: "stage_change",
      contactId: deal.contactId,
      companyId: deal.companyId,
      dealId: deal._id,
      userId: ownerId,
      subject: "Deal stage changed",
      body: `Deal "${deal.title}" moved to a new pipeline stage.`,
      metadata: {
        previousStageId: currentDeal.stageId,
        newStageId: deal.stageId
      }
    });
  }

  return getDealById(deal._id, ownerId);
}

export async function moveDeal(
  dealId,
  ownerId,
  stageId
) {
  const deal = await Deal.findOne({
    _id: dealId,
    ownerId
  });

  if (!deal) {
    throw new AppError(
      "Deal not found.",
      404,
      "DEAL_NOT_FOUND"
    );
  }

  const stage = await PipelineStage.findOne({
    _id: stageId,
    pipelineId: deal.pipelineId,
    isActive: true
  });

  if (!stage) {
    throw new AppError(
      "The selected stage does not belong to this deal's pipeline.",
      400,
      "INVALID_PIPELINE_STAGE"
    );
  }

  let status = "open";

  if (stage.isClosedWon) {
    status = "won";
  }

  if (stage.isClosedLost) {
    status = "lost";
  }

  deal.stageId = stage._id;
  deal.status = status;
  deal.lastActivityAt = new Date();

  await deal.save();

  await Activity.create({
    type: "stage_change",
    contactId: deal.contactId,
    companyId: deal.companyId,
    dealId: deal._id,
    userId: ownerId,
    subject: "Deal moved",
    body: `Deal "${deal.title}" moved to "${stage.name}".`,
    metadata: {
      stageId: stage._id,
      status
    }
  });

  return getDealById(deal._id, ownerId);
}

export async function deleteDeal(dealId, ownerId) {
  const deal = await Deal.findOne({
    _id: dealId,
    ownerId
  });

  if (!deal) {
    throw new AppError(
      "Deal not found.",
      404,
      "DEAL_NOT_FOUND"
    );
  }

  await deal.deleteOne();

  await Activity.deleteMany({
    dealId: deal._id
  });

  return {
    id: dealId,
    deleted: true
  };
}