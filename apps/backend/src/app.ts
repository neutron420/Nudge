import express from "express";
import helmet from "helmet";
import cors from "cors";
import logger from "./config/logger.js";
import { env } from "./config/env.js";
import {
  requestIdMiddleware,
  errorHandlerMiddleware,
} from "./common/errors/custom-errors.js";

// Import routers
import authRouter from "./modules/auth/auth.routes.js";
import eventsRouter from "./modules/events/events.routes.js";
import remindersRouter from "./modules/reminders/reminders.routes.js";
import notificationsRouter from "./modules/notifications/notifications.routes.js";
import dashboardRouter from "./modules/dashboard/dashboard.routes.js";

// Import scheduler heartbeat
import { lastSchedulerTick } from "./scheduler/reminder.scheduler.js";
import { prisma } from "./db/prisma.js";

const app = express();

// Security and utility middleware
app.use(helmet());

const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestIdMiddleware);

// Log incoming request info
app.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
    requestId: req.requestId,
  });
  next();
});

// Health Checks
app.get("/health/live", (req, res) => {
  res.status(200).json({ status: "alive", timestamp: new Date() });
});

app.get("/health/ready", async (req, res) => {
  try {
    // Validate database connection
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready", services: { database: "healthy" } });
  } catch (error: any) {
    logger.error("Readiness health check failed:", error.message);
    res.status(503).json({ status: "unready", services: { database: "unhealthy" } });
  }
});

app.get("/health/scheduler", (req, res) => {
  if (lastSchedulerTick) {
    res.status(200).json({
      status: "running",
      lastTick: lastSchedulerTick.toISOString(),
      ageMs: Date.now() - lastSchedulerTick.getTime(),
    });
  } else {
    res.status(200).json({
      status: "starting",
      lastTick: null,
    });
  }
});

// Mount modules (scoped under /api/v1)
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/events", eventsRouter);
// remindersRouter handles both /events/.../reminders and /reminders
app.use("/api/v1", remindersRouter);
app.use("/api/v1/notifications", notificationsRouter);
app.use("/api/v1/dashboard", dashboardRouter);

// Global Error Handler
app.use(errorHandlerMiddleware);

export default app;
