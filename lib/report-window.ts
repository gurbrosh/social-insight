/**
 * Same rolling "last N days/weeks/months" window as the email report (local server clock).
 */
export type ReportRangeUnit = "days" | "weeks" | "months";

export function getRollingWindowStart(
  rangeAmount: number,
  rangeUnit: ReportRangeUnit,
  now: Date = new Date()
): Date {
  const start = new Date(now.getTime());
  if (rangeUnit === "days") {
    start.setDate(start.getDate() - rangeAmount);
  } else if (rangeUnit === "weeks") {
    start.setDate(start.getDate() - rangeAmount * 7);
  } else {
    start.setMonth(start.getMonth() - rangeAmount);
  }
  return start;
}
