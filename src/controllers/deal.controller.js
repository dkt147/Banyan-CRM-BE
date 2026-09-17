import {
  createDeal,
  getDeals,
  getDealById,
  updateDeal,
  moveDeal,
  deleteDeal
} from "../services/deal.service.js";

import {
  createDealSchema,
  updateDealSchema,
  moveDealSchema,
  dealIdParamSchema,
  dealListQuerySchema
} from "../validators/deal.validators.js";

export async function createDealController(req, res) {
  const data = createDealSchema.parse(req.body);

  const deal = await createDeal(
    data,
    req.user.id
  );

  return res.status(201).json({
    success: true,
    message: "Deal created successfully.",
    data: deal
  });
}

export async function getDealsController(req, res) {
  const query = dealListQuerySchema.parse(req.query);

  const result = await getDeals({
    ...query,
    ownerId: req.user.id
  });

  return res.status(200).json({
    success: true,
    message: "Deals fetched successfully.",
    data: result.deals,
    pagination: result.pagination
  });
}

export async function getDealController(req, res) {
  const { dealId } =
    dealIdParamSchema.parse(req.params);

  const deal = await getDealById(
    dealId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Deal fetched successfully.",
    data: deal
  });
}

export async function updateDealController(req, res) {
  const { dealId } =
    dealIdParamSchema.parse(req.params);

  const data = updateDealSchema.parse(req.body);

  const deal = await updateDeal(
    dealId,
    req.user.id,
    data
  );

  return res.status(200).json({
    success: true,
    message: "Deal updated successfully.",
    data: deal
  });
}

export async function moveDealController(req, res) {
  const { dealId } =
    dealIdParamSchema.parse(req.params);

  const { stageId } =
    moveDealSchema.parse(req.body);

  const deal = await moveDeal(
    dealId,
    req.user.id,
    stageId
  );

  return res.status(200).json({
    success: true,
    message: "Deal moved successfully.",
    data: deal
  });
}

export async function deleteDealController(req, res) {
  const { dealId } =
    dealIdParamSchema.parse(req.params);

  const result = await deleteDeal(
    dealId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Deal deleted successfully.",
    data: result
  });
}