import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { makeResourceController } from "../controllers/resource.controller.js";
export function resourceRouter(service, options = {}) {
  const r = Router();
  const c = makeResourceController(service);
  r.use(requireAuth);
  r.get("/", c.list);
  r.post("/", c.create);
  r.get("/:id", c.get);
  r.patch("/:id", c.update);
  if (options.delete !== false) r.delete("/:id", c.remove);
  return r;
}
