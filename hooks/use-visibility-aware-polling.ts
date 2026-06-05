"use client";

import { useEffect, useRef } from "react";

const DEFAULT_HIDDEN_INTERVAL_MS = 60_000;

/** Spread first tick across components so many mounted hooks don't hit the API in the same frame. */
const MAX_MOUNT_JITTER_MS = 2_500;

export type UseVisibilityAwarePollingOptions = {
  /** Called on each tick when the tab is visible; skipped while hidden (tab switch restores run + reschedules). */
  onPoll: () => void | Promise<void>;
  /** Polling interval when `document.visibilityState === "visible"`. */
  intervalMs: number;
  /** Slower interval when the tab is hidden (default 60s) to reduce SQLite/API load during heavy work. */
  hiddenIntervalMs?: number;
  /** When false, no interval is registered. */
  enabled?: boolean;
};

/**
 * Polls on an interval, slows down when the browser tab is hidden, and skips work while hidden
 * so background tabs do not hammer the API/DB during scrapes or analysis.
 *
 * Also: skips a tick if the previous poll is still in flight (avoids piling requests when SQLite is slow),
 * and delays the first poll by a random jitter so multiple hooks do not synchronize on one burst.
 */
export function useVisibilityAwarePolling({
  onPoll,
  intervalMs,
  hiddenIntervalMs = DEFAULT_HIDDEN_INTERVAL_MS,
  enabled = true,
}: UseVisibilityAwarePollingOptions): void {
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  const inFlightRef = useRef(false);
  const mountJitterMsRef = useRef(
    typeof Math !== "undefined" ? Math.floor(Math.random() * MAX_MOUNT_JITTER_MS) : 0
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;
    let mountJitterTimer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      void Promise.resolve(onPollRef.current())
        .catch(() => {
          /* errors logged inside onPoll */
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    const schedule = () => {
      if (timer) {
        clearInterval(timer);
      }
      const ms =
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? hiddenIntervalMs
          : intervalMs;
      timer = setInterval(run, ms);
    };

    mountJitterTimer = setTimeout(() => {
      mountJitterTimer = null;
      void run();
    }, mountJitterMsRef.current);

    schedule();

    const onVisibility = () => {
      void run();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (mountJitterTimer) {
        clearTimeout(mountJitterTimer);
      }
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [enabled, intervalMs, hiddenIntervalMs]);
}
