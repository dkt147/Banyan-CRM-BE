import { asyncHandler } from "../utils/asyncHandler.js";
export function makeResourceController(service) {
  return {
    list: asyncHandler(async (req, res) =>
      res.json({
        success: true,
        data: await service.list(req.workspaceId, req.query),
      }),
    ),
    get: asyncHandler(async (req, res) =>
      res.json({
        success: true,
        data: await service.get(req.workspaceId, req.params.id),
      }),
    ),
    create: asyncHandler(async (req, res) =>
      res.status(201).json({
        success: true,
        data: await service.create(req.workspaceId, req.user._id, req.body),
      }),
    ),
    update: asyncHandler(async (req, res) =>
      res.json({
        success: true,
        data: await service.update(
          req.workspaceId,
          req.params.id,
          req.user._id,
          req.body,
        ),
      }),
    ),
    remove: asyncHandler(async (req, res) =>
      res.json({
        success: true,
        data: await service.remove(req.workspaceId, req.params.id),
      }),
    ),
  };
}
