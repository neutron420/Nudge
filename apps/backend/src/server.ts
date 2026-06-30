import app from "./app.js";
import { env } from "./config/env.js";
import logger from "./config/logger.js";
import { prisma } from "./db/prisma.js";
import { startScheduler } from "./scheduler/reminder.scheduler.js";

async function main() {
  try {
    logger.info("Connecting to database...");
    await prisma.$connect();
    logger.info("Database connection established successfully");

    // Start Express listener
    const server = app.listen(env.PORT, () => {
      logger.info(`Nudge API Server is running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    });

    // Start scheduler engine
    startScheduler();

    // Graceful Shutdown Handler
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      server.close(() => {
        logger.info("HTTP server closed.");
      });

      try {
        await prisma.$disconnect();
        logger.info("Database connection disconnected.");
      } catch (err: any) {
        logger.error("Error during database disconnect:", err.message);
      }

      logger.info("Graceful shutdown complete. Exiting process.");
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error: any) {
    logger.fatal("Failed to start Nudge backend server:", error.message);
    process.exit(1);
  }
}

main();
