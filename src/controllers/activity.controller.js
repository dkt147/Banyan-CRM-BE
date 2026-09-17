import {
  createActivity,
  getActivities,
  getActivityById,
  deleteActivity
} from "../services/activity.service.js";

import {
  createActivitySchema,
  activityIdParamSchema,
  activityListQuerySchema
} from "../validators/activity.validators.js";

export async function createActivityController(
  req,
  res
) {
  const data = createActivitySchema.parse(req.body);

  const activity = await createActivity(
    data,
    req.user.id
  );

  return res.status(201).json({
    success: true,
    message: "Activity created successfully.",
    data: activity
  });
}

export async function getActivitiesController(
  req,
  res
) {
  const query =
    activityListQuerySchema.parse(req.query);

  const result = await getActivities({
    ...query,
    userId: req.user.id
  });

  return res.status(200).json({
    success: true,
    message: "Activities fetched successfully.",
    data: result.activities,
    pagination: result.pagination
  });
}

export async function getActivityController(
  req,
  res
) {
  const { activityId } =
    activityIdParamSchema.parse(req.params);

  const activity = await getActivityById(
    activityId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Activity fetched successfully.",
    data: activity
  });
}

export async function deleteActivityController(
  req,
  res
) {
  const { activityId } =
    activityIdParamSchema.parse(req.params);

  const result = await deleteActivity(
    activityId,
    req.user.id
  );

  return res.status(200).json({
    success: true,
    message: "Activity deleted successfully.",
    data: result
  });
}