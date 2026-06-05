/**
 * Formats a date to include date, time, and timezone in browser's local time
 * Format: MM/DD/YYYY HH:MM:SS am/pm TIMEZONE
 * Example: 10/09/2025 09:31:55 am PST
 */
export function formatPostDateTime(dateString: string): string {
  const date = new Date(dateString);

  // Get date part (MM/DD/YYYY)
  const datePart = date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });

  // Get time part (HH:MM:SS am/pm)
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  // Get timezone abbreviation (e.g., PST, EST, GMT)
  const timezone =
    date
      .toLocaleTimeString("en-US", {
        timeZoneName: "short",
      })
      .split(" ")
      .pop() || "";

  return `${datePart} ${timePart} ${timezone}`;
}

/**
 * Gets a Prisma date filter object for the given date range
 * Returns an object like { gte: Date } for filtering
 *
 * Supported values:
 * - `all` or empty: no filter (returns null)
 * - `days:N` — rolling window: posts on or after (now − N×24h), N clamped 1..3650
 * - Legacy: `today`, `week`, `month`, `quarter` (kept for bookmarks / older links)
 */
export function getDateRangeFilter(dateRange: string): { gte: Date } | null {
  const raw = dateRange?.trim() ?? "";
  if (!raw || raw === "all") {
    return null;
  }

  const daysMatch = /^days:(\d+)$/i.exec(raw);
  if (daysMatch) {
    const n = Math.min(Math.max(parseInt(daysMatch[1], 10), 1), 3650);
    const now = new Date();
    return { gte: new Date(now.getTime() - n * 24 * 60 * 60 * 1000) };
  }

  const now = new Date();
  let startDate = new Date();

  switch (raw) {
    case "today":
      // Last 24 hours (rolling window)
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "week":
      startDate.setDate(now.getDate() - 7);
      break;
    case "month":
      startDate.setMonth(now.getMonth() - 1);
      break;
    case "quarter":
      startDate.setMonth(now.getMonth() - 3);
      break;
    default:
      return null;
  }

  return { gte: startDate };
}

/** Human-readable label for filter badges (e.g. `days:7` → "Last 7 days"). */
export function formatDateRangeLabel(dateRange: string): string {
  const raw = dateRange?.trim() ?? "";
  if (!raw || raw === "all") {
    return "All time";
  }
  const m = /^days:(\d+)$/i.exec(raw);
  if (m) {
    return `Last ${m[1]} days`;
  }
  switch (raw) {
    case "today":
      return "Last 24 hours";
    case "week":
      return "Last 7 days";
    case "month":
      return "Last month";
    case "quarter":
      return "Last quarter";
    default:
      return raw;
  }
}
