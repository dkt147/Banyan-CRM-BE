import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { securityMiddleware } from "./middleware/security.middleware.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";
import companyRoutes from "./routes/company.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import pipelineRoutes from "./routes/pipeline.routes.js";
import dealRoutes from "./routes/deal.routes.js";
import activityRoutes from "./routes/activity.routes.js";
import taskRoutes from "./routes/task.routes.js";

const app = express();
app.use(helmet());

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.disable("x-powered-by");

app.use(...securityMiddleware);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "Banyan CRM API",
    version: "v1",
    message: "API is running."
  });
});

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/companies", companyRoutes);
app.use("/api/v1/contacts", contactRoutes);
app.use("/api/v1/pipelines", pipelineRoutes);
app.use("/api/v1/deals", dealRoutes);
app.use("/api/v1/activities", activityRoutes);
app.use("/api/v1/tasks", taskRoutes);


app.use(notFoundHandler);
app.use(errorHandler);

export default app;
