import type { HnFirebaseItem } from "./types";

const ITEM_BASE = "https://hacker-news.firebaseio.com/v0/item";

const ENRICH_DELAY_MS = 200;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchItem(id: string): Promise<HnFirebaseItem> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${ITEM_BASE}/${encodeURIComponent(id)}.json`, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/json" },
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(1500 * 2 ** (attempt - 1), 20_000);
        console.warn(
          `[hn-firebase] retry item=${id} attempt=${attempt}/${MAX_RETRIES} status=${res.status} waitMs=${wait}`
        );
        if (attempt < MAX_RETRIES) {
          await sleep(wait);
          continue;
        }
        return null;
      }
      if (!res.ok) {
        console.warn(`[hn-firebase] item=${id} HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as HnFirebaseItem;
      await sleep(ENRICH_DELAY_MS);
      return data;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(
        `[hn-firebase] item=${id} attempt=${attempt}/${MAX_RETRIES} error=${lastError.message}`
      );
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
      }
    }
  }
  return null;
}
