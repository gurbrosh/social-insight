import fs from "node:fs/promises";
import path from "node:path";
import { initializeStorageProvider, getStorageProvider } from "crunchycone-lib/services/storage";

/**
 * Read uploaded my-product file into a buffer (LocalStorage or stream-capable provider).
 */
export async function readStorageFileToBuffer(storageKey: string): Promise<Buffer> {
  try {
    initializeStorageProvider();
  } catch {
    // already initialized
  }
  const provider = getStorageProvider() as {
    getFileStream?: (
      key: string,
      opts: Record<string, unknown>
    ) => Promise<{ stream: unknown; contentLength?: number }>;
  };

  if (typeof provider.getFileStream === "function") {
    const result = await provider.getFileStream(storageKey, {});
    const stream = result.stream;
    if (stream && typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
      const reader = (stream as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    }
  }

  const base = process.env.CRUNCHYCONE_LOCALSTORAGE_PATH;
  if (base && typeof base === "string" && base.length > 0) {
    const full = path.join(base, storageKey);
    return fs.readFile(full);
  }

  throw new Error("Storage is not configured to read files");
}
