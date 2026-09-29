import { AppError } from "../utils/AppError.js";

export function createResourceService(Model, config = {}) {
  const {
    searchable = [],
    populate = [],
    defaultSort = { createdAt: -1 },
    ownerField = null,
    createdByField = null,
    softDeleteField = null,
  } = config;
  function base(workspaceId) {
    return { workspaceId };
  }
  async function list(workspaceId, query = {}) {
    const page = Math.max(Number(query.page) || 1, 1),
      limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const filter = base(workspaceId);
    if (query.search && searchable.length)
      filter.$or = searchable.map((f) => ({
        [f]: { $regex: String(query.search), $options: "i" },
      }));
    const reserved = new Set(["page", "limit", "search", "sort", "order"]);
    for (const [k, v] of Object.entries(query)) {
      if (reserved.has(k) || v === "" || v == null) continue;
      if (config.filters?.includes(k)) filter[k] = v;
    }
    const sortField = config.sortFields?.includes(query.sort)
      ? query.sort
      : Object.keys(defaultSort)[0];
    const sort = { [sortField]: query.order === "asc" ? 1 : -1 };
    let q = Model.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);
    for (const p of populate) q = q.populate(p);
    const [items, total] = await Promise.all([
      q.lean(),
      Model.countDocuments(filter),
    ]);
    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
  async function get(workspaceId, id) {
    let q = Model.findOne({ _id: id, ...base(workspaceId) });
    for (const p of populate) q = q.populate(p);
    const doc = await q;
    if (!doc) throw new AppError("Resource not found.", 404, "NOT_FOUND");
    return doc;
  }
  async function create(workspaceId, userId, payload) {
    const data = { ...payload, workspaceId };
    if (ownerField && !data[ownerField]) data[ownerField] = userId;
    if (createdByField) data[createdByField] = userId;
    return Model.create(data);
  }
  async function update(workspaceId, id, userId, payload) {
    const forbidden = new Set(["_id", "workspaceId", "createdAt", "updatedAt"]);
    if (ownerField) forbidden.add(ownerField);
    const patch = Object.fromEntries(
      Object.entries(payload).filter(([k]) => !forbidden.has(k)),
    );
    if (createdByField) delete patch[createdByField];
    const doc = await Model.findOneAndUpdate(
      { _id: id, ...base(workspaceId) },
      patch,
      { new: true, runValidators: true },
    );
    if (!doc) throw new AppError("Resource not found.", 404, "NOT_FOUND");
    return doc;
  }
  async function remove(workspaceId, id) {
    const doc = await Model.findOne({ _id: id, ...base(workspaceId) });
    if (!doc) throw new AppError("Resource not found.", 404, "NOT_FOUND");
    if (softDeleteField) {
      doc[softDeleteField] = true;
      await doc.save();
      return doc;
    }
    await doc.deleteOne();
    return doc;
  }
  return { list, get, create, update, remove };
}
