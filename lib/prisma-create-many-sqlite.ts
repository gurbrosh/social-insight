import { Prisma } from "@prisma/client";

/** True when Prisma hit a unique constraint (e.g. concurrent duplicate insert). */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type CreateManyDelegate<T> = {
  createMany: (args: { data: T | T[] }) => Promise<{ count: number }>;
  create: (args: { data: T }) => Promise<unknown>;
};

/**
 * SQLite `createMany` in this project does not accept `skipDuplicates` (not generated for sqlite).
 * Batch insert; on unique violation, insert rows one-by-one and ignore duplicates.
 */
export async function createManySkippingDuplicatesSqlite<T extends Record<string, unknown>>(
  delegate: CreateManyDelegate<T>,
  rows: T[],
  chunkSize: number
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    if (slice.length === 0) continue;
    try {
      await delegate.createMany({ data: slice });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      for (const row of slice) {
        try {
          await delegate.create({ data: row });
        } catch (inner) {
          if (!isUniqueConstraintError(inner)) throw inner;
        }
      }
    }
    // Let I/O and HTTP handlers (e.g. UI polling) run between SQLite write batches.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
