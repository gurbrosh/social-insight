import { Prisma, PrismaClient } from "@prisma/client";
import { ulidExtension } from "@/lib/utils/ulid";
import { logger } from "@/lib/utils/logger";

// Configure logging based on environment variable
const logConfig = process.env.PRISMA_LOG_LEVEL
  ? (process.env.PRISMA_LOG_LEVEL.split(",").map((level) => level.trim()) as (
      | "query"
      | "info"
      | "warn"
      | "error"
    )[])
  : undefined;

const clientConfig = logConfig
  ? {
      log: logConfig.map((level) => ({
        level: level as "query" | "info" | "warn" | "error",
        emit: "event" as const,
      })),
    }
  : undefined;

// Create base Prisma client
let basePrismaAuth: PrismaClient;

// Check if we're using Turso (libSQL)
if (process.env.DATABASE_URL?.startsWith("libsql://") && process.env.TURSO_AUTH_TOKEN) {
  try {
    // Import Turso adapter - webpack is configured to handle these files
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSQL } = require("@prisma/adapter-libsql");

    const adapter = new PrismaLibSQL({
      url: process.env.DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    basePrismaAuth = new PrismaClient({ ...(clientConfig || {}), adapter });
    console.log("✅ Auth Turso adapter initialized successfully");
  } catch (error) {
    console.error(
      "Failed to initialize Auth Turso adapter, falling back to standard client:",
      error
    );
    basePrismaAuth = new PrismaClient(clientConfig);
  }
} else {
  // Standard SQLite/PostgreSQL/MySQL
  basePrismaAuth = new PrismaClient(clientConfig);
}

// Set up structured logging event listeners for auth client
if (logConfig && basePrismaAuth) {
  // Type assertion for PrismaClient with event emitters enabled
  type PrismaClientWithEvents = PrismaClient & {
    $on(event: "query", callback: (e: Prisma.QueryEvent) => void): void;
    $on(event: "info", callback: (e: Prisma.LogEvent) => void): void;
    $on(event: "warn", callback: (e: Prisma.LogEvent) => void): void;
    $on(event: "error", callback: (e: Prisma.LogEvent) => void): void;
  };

  const eventPrisma = basePrismaAuth as PrismaClientWithEvents;

  logConfig.forEach((level) => {
    switch (level) {
      case "query":
        eventPrisma.$on("query", (e: Prisma.QueryEvent) => {
          logger.debug("Auth Database Query", {
            query: e.query,
            params: e.params,
            duration: `${e.duration}ms`,
            target: e.target,
          });
        });
        break;
      case "info":
        eventPrisma.$on("info", (e: Prisma.LogEvent) => {
          logger.info("Auth Database Info", { message: e.message, target: e.target });
        });
        break;
      case "warn":
        eventPrisma.$on("warn", (e: Prisma.LogEvent) => {
          logger.warn("Auth Database Warning", { message: e.message, target: e.target });
        });
        break;
      case "error":
        eventPrisma.$on("error", (e: Prisma.LogEvent) => {
          logger.error("Auth Database Error", undefined, { message: e.message, target: e.target });
        });
        break;
    }
  });
}

// Wrap Prisma client to intercept and log all errors
const prismaAuthWithErrorLogging = basePrismaAuth.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        try {
          return await query(args);
        } catch (error: any) {
          // Log detailed error information
          const errorDetails = {
            model,
            operation,
            name: error?.name,
            message: error?.message,
            code: error?.code,
            meta: error?.meta,
            cause: error?.cause,
            clientVersion: error?.clientVersion,
            digest: error?.digest,
            stack: error?.stack,
          };
          console.error(
            `[Auth Prisma Error Interceptor] Error in ${model}.${operation}:`,
            JSON.stringify(errorDetails, null, 2)
          );
          throw error; // Re-throw to maintain original behavior
        }
      },
    },
  },
});

// Prisma client for Auth.js with ULID extension
// This ensures OAuth users get proper ULID IDs
export const prismaAuth = prismaAuthWithErrorLogging.$extends(ulidExtension);
