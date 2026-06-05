import { ulid } from "ulid";
import { Prisma, PrismaClient } from "@prisma/client";
import { logger } from "./logger";

/**
 * Generate a new ULID
 */
export function generateId(): string {
  try {
    const id = ulid();
    return id;
  } catch (error) {
    console.error(`❌ ULID generation failed:`, error);
    throw error;
  }
}

/**
 * Validate if a string is a valid ULID
 */
export function isValidUlid(id: string): boolean {
  // ULID is exactly 26 characters and uses Crockford's Base32
  const ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/;
  return ulidRegex.test(id);
}

/** Ensure id is a non-empty string; otherwise return a new ULID. Prevents unique constraint on "". */
function ensureId(id: unknown): string {
  const s = typeof id === "string" ? id : "";
  return s.trim() !== "" ? s : generateId();
}

/**
 * Prisma Client Extension for automatic ULID generation
 */
export const ulidExtension = Prisma.defineExtension({
  name: "ulid-extension",
  query: {
    user: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    userProfile: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    role: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    userRole: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    project: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    projectKeyword: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    scraper: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    // Note: Do NOT set ULID on Post since its id is Int autoincrement
    scrapeJob: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    projectBrand: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    projectMyProductDocument: {
      create({ args, query }) {
        args.data.id = ensureId(args.data.id);
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: ensureId(item.id),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = ensureId(args.create.id);
        return query(args);
      },
    },
    projectSource: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    projectProfile: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    orchestration: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    orchestrationExecution: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    orchestrationThreadExecution: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    orchestrationStepExecution: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    appConfig: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    businessTaxonomy: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    brand: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    brandKeyword: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    taxonomyRedditLink: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    brandRedditLink: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    brandAdditionalLink: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    projectTheme: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    responseObjective: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    themeItemResponse: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    taxonomyInfluencerLink: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    taxonomyOtherSourceLink: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    projectBrandSource: {
      create({ args, query }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    // SearchSourceTask: ULID for new tasks; existing tasks may have empty id (use update-by-name in UI)
    searchSourceTask: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = args.data.id || generateId();
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({
            ...item,
            id: item.id || generateId(),
          }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = args.create.id || generateId();
        return query(args);
      },
    },
    // TaskRun: schema @default("") — never allow "" so long runs never hit unique constraint
    taskRun: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    // Pipeline / blog models: schema @default("") — ensure ULID so multiple creates never collide
    blogAnalysisRun: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    blogNewsAnalysis: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    blogPost: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    postNews: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    analysisProgress: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    sourceMention: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    hnKeywordIngestCursor: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    githubSignal: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
    githubIngestCursor: {
      create({ args, query }: { args: any; query: any }) {
        args.data.id = ensureId(args.data?.id);
        return query(args);
      },
      createMany({ args, query }: { args: any; query: any }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((item: any) => ({ ...item, id: ensureId(item?.id) }));
        }
        return query(args);
      },
      upsert({ args, query }: { args: any; query: any }) {
        args.create.id = ensureId(args.create?.id);
        return query(args);
      },
    },
  },
});

/**
 * Create a Prisma client with ULID extension
 */
export function createPrismaClient() {
  let basePrisma: PrismaClient;

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

      basePrisma = new PrismaClient({ ...(clientConfig || {}), adapter });
      console.log("✅ Turso adapter initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Turso adapter, falling back to standard client:", error);
      basePrisma = new PrismaClient(clientConfig);
    }
  } else {
    // Standard SQLite/PostgreSQL/MySQL
    basePrisma = new PrismaClient(clientConfig);
  }

  // Set up structured logging event listeners
  if (logConfig && basePrisma) {
    // Type assertion for PrismaClient with event emitters enabled
    type PrismaClientWithEvents = PrismaClient & {
      $on(event: "query", callback: (e: Prisma.QueryEvent) => void): void;
      $on(event: "info", callback: (e: Prisma.LogEvent) => void): void;
      $on(event: "warn", callback: (e: Prisma.LogEvent) => void): void;
      $on(event: "error", callback: (e: Prisma.LogEvent) => void): void;
    };

    const eventPrisma = basePrisma as PrismaClientWithEvents;

    logConfig.forEach((level) => {
      switch (level) {
        case "query":
          eventPrisma.$on("query", (e: Prisma.QueryEvent) => {
            logger.debug("Database Query", {
              query: e.query,
              params: e.params,
              duration: `${e.duration}ms`,
              target: e.target,
            });
          });
          break;
        case "info":
          eventPrisma.$on("info", (e: Prisma.LogEvent) => {
            logger.info("Database Info", { message: e.message, target: e.target });
          });
          break;
        case "warn":
          eventPrisma.$on("warn", (e: Prisma.LogEvent) => {
            logger.warn("Database Warning", { message: e.message, target: e.target });
          });
          break;
        case "error":
          eventPrisma.$on("error", (e: Prisma.LogEvent) => {
            logger.error("Database Error", undefined, { message: e.message, target: e.target });
          });
          break;
      }
    });
  }

  // Apply ULID extension
  // Wrap Prisma client to intercept and log all errors
  const prismaWithErrorLogging = basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          try {
            return await query(args);
          } catch (error: any) {
            // Skip logging P2002 (unique constraint) errors - these are expected and handled gracefully
            if (error?.code !== "P2002") {
              // Log detailed error information for unexpected errors
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
                `[Prisma Error Interceptor] Error in ${model}.${operation}:`,
                JSON.stringify(errorDetails, null, 2)
              );
            }
            throw error; // Re-throw to maintain original behavior
          }
        },
      },
    },
  });

  return prismaWithErrorLogging.$extends(ulidExtension);
}
