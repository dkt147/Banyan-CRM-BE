import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import {
  callbackUrls,
  docusignCallback,
  googleCallback,
  startGoogleConnect,
  startXeroConnect,
  xeroCallback,
} from "../controllers/integrationOAuth.controller.js";

const r = Router();

// Public provider callbacks must be registered before the generic authenticated CRUD router.
r.get("/callback-urls", callbackUrls);
r.get("/xero/connect", requireAuth, startXeroConnect);
r.get("/xero/callback", xeroCallback);
r.get("/google/connect", requireAuth, startGoogleConnect);
r.get("/google/callback", googleCallback);
r.get("/docusign/callback", docusignCallback);

// Preserve the existing integration record CRUD endpoints.
r.use(resourceRouter(resourceRegistry["integrations"].service));

export default r;
