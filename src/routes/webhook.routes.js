import { Router } from "express";
import { receive } from "../controllers/webhook.controller.js";
const r = Router();
r.post("/:provider", receive);
export default r;
