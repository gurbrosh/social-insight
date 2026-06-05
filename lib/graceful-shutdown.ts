import { orchestrationExecutor } from "./orchestration-executor";

let isShuttingDown = false;

export function setupGracefulShutdown() {
  // Handle SIGTERM (Docker, PM2, etc.)
  process.on("SIGTERM", async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("🛑 SIGTERM received - gracefully shutting down orchestrations...");
    await gracefulShutdown();
    process.exit(0);
  });

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("🛑 SIGINT received - gracefully shutting down orchestrations...");
    await gracefulShutdown();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", async (error) => {
    console.error("💥 Uncaught Exception:", error);
    if (!isShuttingDown) {
      isShuttingDown = true;
      await gracefulShutdown();
    }
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", async (reason, promise) => {
    console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
    if (!isShuttingDown) {
      isShuttingDown = true;
      await gracefulShutdown();
    }
    process.exit(1);
  });
}

async function gracefulShutdown() {
  try {
    console.log("🛑 Stopping all orchestrations...");
    await orchestrationExecutor.forceReset();
    console.log("✅ All orchestrations stopped gracefully");
  } catch (error) {
    console.error("❌ Error during graceful shutdown:", error);
  }
}
