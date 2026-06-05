import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getDateRangeFilter } from "@/lib/utils/date-formatter";

export const dynamic = "force-dynamic";

interface BrandMention {
  brandName: string;
  totalMentions: number;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
}

async function computeUnifiedTimelineStart(
  projectId: string,
  brandNames: string[]
): Promise<Date | null> {
  const records = await prisma.brandAnalysis.findMany({
    where: {
      project_id: projectId,
      brand_name: { in: brandNames },
    },
    select: {
      mention_timestamp: true,
    },
  });

  if (records.length === 0) {
    return null;
  }

  const dateTotals = new Map<string, number>();
  for (const record of records) {
    const dateKey = record.mention_timestamp.toISOString().split("T")[0];
    dateTotals.set(dateKey, (dateTotals.get(dateKey) ?? 0) + 1);
  }

  const allDates = Array.from(dateTotals.keys()).sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  );
  if (allDates.length === 0) {
    return null;
  }

  const latestDateKey = allDates[allDates.length - 1];
  const start = new Date(`${latestDateKey}T00:00:00Z`);
  const TIMELINE_WINDOW_DAYS = 5;
  start.setDate(start.getDate() - TIMELINE_WINDOW_DAYS);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const dateRange = searchParams.get("dateRange") || "all";
    const view = searchParams.get("view") || "summary"; // "summary" or "timeline"
    const selectedBrandsParam = searchParams.get("brands");
    // Decode URL-encoded brand names (handles + as spaces and other encoding)
    const selectedBrands = selectedBrandsParam
      ? selectedBrandsParam.split(",").map((b) => decodeURIComponent(b.trim()).replace(/\+/g, " "))
      : [];

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        user_id: session.user.id,
        deleted_at: null,
      },
      include: {
        brands: {
          where: { deleted_at: null },
          select: { brand_name: true },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Get all available brands (for the dropdown/selection) - always return this
    const allBrandNames = project.brands.map((b) => b.brand_name);

    // If no brands configured, return early
    if (allBrandNames.length === 0) {
      return NextResponse.json({
        brands: [],
        allBrands: [],
      });
    }

    // Get brands to analyze
    const brandsToAnalyze =
      selectedBrands.length > 0
        ? project.brands.filter((b) => selectedBrands.includes(b.brand_name))
        : project.brands;

    if (brandsToAnalyze.length === 0) {
      return NextResponse.json({
        brands: [],
        allBrands: allBrandNames,
      });
    }

    const brandNames = brandsToAnalyze.map((b) => b.brand_name);

    // Build date filter
    const dateFilter = getDateRangeFilter(dateRange);

    const firstCompletedJob = await prisma.scrapeJob.findFirst({
      where: {
        project_id: projectId,
        deleted_at: null,
        status: "COMPLETED",
        posts_count: { gt: 0 },
      },
      orderBy: { completed_at: "asc" },
      select: {
        created_at: true,
        started_at: true,
        completed_at: true,
      },
    });

    const fallbackBaseDate =
      firstCompletedJob?.started_at ??
      firstCompletedJob?.completed_at ??
      firstCompletedJob?.created_at ??
      (
        await prisma.scrapeJob.findFirst({
          where: { project_id: projectId, deleted_at: null },
          orderBy: { created_at: "asc" },
          select: { created_at: true },
        })
      )?.created_at ??
      (
        await prisma.post.findFirst({
          where: {
            project_id: projectId,
          },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        })
      )?.createdAt ??
      null;

    let unifiedCutoff = await computeUnifiedTimelineStart(projectId, brandNames);
    if (!unifiedCutoff && fallbackBaseDate) {
      unifiedCutoff = new Date(fallbackBaseDate);
      unifiedCutoff.setDate(unifiedCutoff.getDate() - 1);
      unifiedCutoff.setHours(0, 0, 0, 0);
    }

    // Query BrandAnalysis table directly (pre-computed data from analysis phase)
    const brandAnalysisWhere: Prisma.BrandAnalysisWhereInput = {
      project_id: projectId,
      deleted_at: null,
      brand_name: { in: brandNames },
    };

    const normalizeDateValue = (value?: Date | string | null) => {
      if (!value) return undefined;
      return value instanceof Date ? value : new Date(value);
    };

    const { gte: rawDateFilterGte, lte: rawDateFilterLte } = (dateFilter ??
      {}) as Prisma.DateTimeFilter;

    const dateFilterStart = normalizeDateValue(rawDateFilterGte);
    const dateFilterEnd = normalizeDateValue(rawDateFilterLte);

    // Only apply date filter when the user selected an explicit range (today, week, month, etc.).
    // Do NOT apply unifiedCutoff here: it would limit "All time" to the last 5 days of data only,
    // making the sentiment/brand chart show a handful of records instead of the full history.
    if (dateFilter) {
      const lowerBound: Date | undefined = dateFilterStart;
      const upperBound: Date | undefined = dateFilterEnd;
      if (lowerBound || upperBound) {
        brandAnalysisWhere.mention_timestamp = {
          ...(lowerBound ? { gte: lowerBound } : {}),
          ...(upperBound ? { lte: upperBound } : {}),
        } satisfies Prisma.DateTimeFilter;
      }
    }

    const brandAnalysisRecords = await prisma.brandAnalysis.findMany({
      where: brandAnalysisWhere,
      select: {
        brand_name: true,
        sentiment: true,
        mention_timestamp: true,
      },
    });

    const enforcedStart = unifiedCutoff;

    console.log("[BrandInsights] Found records:", brandAnalysisRecords.length);

    // Handle timeline view vs summary view
    if (view === "timeline") {
      // Group data by time buckets (daily)
      interface TimelineDataPoint {
        date: string; // ISO date string (YYYY-MM-DD)
        brandName: string;
        mentions: number;
        positive: number;
        negative: number;
      }

      // Map to group by date and brand
      const timelineMap = new Map<string, Map<string, TimelineDataPoint>>();

      // Process all records
      for (const record of brandAnalysisRecords) {
        const date = new Date(record.mention_timestamp);
        const dateKey = date.toISOString().split("T")[0]; // YYYY-MM-DD

        if (!timelineMap.has(dateKey)) {
          timelineMap.set(dateKey, new Map());
        }

        const brandMap = timelineMap.get(dateKey)!;

        if (!brandMap.has(record.brand_name)) {
          brandMap.set(record.brand_name, {
            date: dateKey,
            brandName: record.brand_name,
            mentions: 0,
            positive: 0,
            negative: 0,
          });
        }

        const dataPoint = brandMap.get(record.brand_name)!;
        dataPoint.mentions++;

        if (record.sentiment === "POSITIVE") {
          dataPoint.positive++;
        } else if (record.sentiment === "NEGATIVE") {
          dataPoint.negative++;
        }
      }

      // Convert to array of dates and sort
      let allDates = Array.from(timelineMap.keys()).sort();

      if (enforcedStart) {
        const startMidnight = new Date(enforcedStart);
        startMidnight.setHours(0, 0, 0, 0);
        allDates = allDates.filter((dateStr) => new Date(dateStr) >= startMidnight);
      }

      // Outlier detection: filter out early dates before the bulk of data
      if (allDates.length > 0) {
        // Calculate total mentions across all dates and brands for percentage calculation
        let totalMentions = 0;
        const dateMentionCounts = new Map<string, number>();

        for (const dateKey of allDates) {
          const brandMap = timelineMap.get(dateKey)!;
          let dateTotal = 0;
          for (const dataPoint of brandMap.values()) {
            dateTotal += dataPoint.mentions;
          }
          dateMentionCounts.set(dateKey, dateTotal);
          totalMentions += dateTotal;
        }

        const sortedDates = [...allDates].sort(
          (a, b) => new Date(a).getTime() - new Date(b).getTime()
        );
        let filteredDates: string[];

        if (dateRange === "all") {
          // For "All Time": Find where the bulk of data actually starts (very aggressive filtering)

          // Calculate all mention counts to find percentiles
          const mentionCounts = sortedDates.map((date) => dateMentionCounts.get(date) || 0);
          const sortedMentionCounts = [...mentionCounts].sort((a, b) => a - b);

          // Find the 75th percentile - this represents high activity days
          const percentile75Index = Math.floor(sortedMentionCounts.length * 0.75);
          const percentile75Value = sortedMentionCounts[percentile75Index] || 0;

          // Find the median (50th percentile) mentions per day
          const medianIndex = Math.floor(sortedMentionCounts.length * 0.5);
          const medianMentions = sortedMentionCounts[medianIndex] || 0;

          // Strategy 1: Find the date range that contains 97.5% of all mentions
          // Work backwards from the end to find where the bulk truly starts
          let cumulativeMentionsFromEnd = 0;
          let cutoffDateIndex = -1;

          for (let i = sortedDates.length - 1; i >= 0; i--) {
            const dateKey = sortedDates[i];
            const mentions = dateMentionCounts.get(dateKey) || 0;
            cumulativeMentionsFromEnd += mentions;
            const cumulativePercentage = (cumulativeMentionsFromEnd / totalMentions) * 100;

            // When we've accumulated ~97.5% of mentions going backwards, that's where we should start forward
            if (cumulativePercentage >= 97.5) {
              cutoffDateIndex = i;
              break;
            }
          }

          // Strategy 2: Find where cumulative mentions from start reach only 0.5% (extremely aggressive)
          let cumulativeMentions = 0;
          let earlyCutoffIndex = -1;

          for (let i = 0; i < sortedDates.length; i++) {
            const dateKey = sortedDates[i];
            const mentions = dateMentionCounts.get(dateKey) || 0;
            cumulativeMentions += mentions;
            const cumulativePercentage = (cumulativeMentions / totalMentions) * 100;

            if (cumulativePercentage >= 0.5) {
              earlyCutoffIndex = i;
              break;
            }
          }

          // Strategy 3: Find first date where mentions consistently exceed 75% of median (or at least 25 mentions)
          // Look for sustained activity (at least 6 out of 7 days above threshold)
          const activityThreshold = Math.max(medianMentions * 0.75, 25);
          let clusterCutoffIndex = -1;

          for (let i = 0; i < sortedDates.length - 6; i++) {
            let daysAboveThreshold = 0;

            // Check next 7 days for consistent high activity
            for (let j = i; j < Math.min(i + 7, sortedDates.length); j++) {
              const dateKey = sortedDates[j];
              const mentions = dateMentionCounts.get(dateKey) || 0;

              if (mentions >= activityThreshold) {
                daysAboveThreshold++;
              }
            }

            // Require at least 6 out of 7 days with high activity
            if (daysAboveThreshold >= 6) {
              clusterCutoffIndex = i;
              break;
            }
          }

          // Strategy 4: Find first date where mentions hit ~75% of the 75th percentile
          let percentileCutoffIndex = -1;
          if (percentile75Value > 0) {
            for (let i = 0; i < sortedDates.length; i++) {
              const dateKey = sortedDates[i];
              const mentions = dateMentionCounts.get(dateKey) || 0;

              if (mentions >= percentile75Value * 0.75) {
                percentileCutoffIndex = i;
                break;
              }
            }
          }

          // Use the most aggressive cutoff - the latest date from all strategies
          const allCutoffs = [
            cutoffDateIndex,
            earlyCutoffIndex,
            clusterCutoffIndex,
            percentileCutoffIndex,
          ].filter((idx) => idx >= 0);

          if (allCutoffs.length > 0) {
            cutoffDateIndex = Math.max(...allCutoffs);
          }

          // Apply the cutoff
          if (cutoffDateIndex >= 0 && cutoffDateIndex < sortedDates.length) {
            filteredDates = sortedDates.slice(cutoffDateIndex);
          } else {
            filteredDates = sortedDates;
          }
        } else {
          // For specific date ranges: Use IQR method to filter outliers
          const datesAsNumbers = allDates.map((d) => new Date(d).getTime());
          datesAsNumbers.sort((a, b) => a - b);

          const q1Index = Math.floor(datesAsNumbers.length * 0.25);
          const q3Index = Math.floor(datesAsNumbers.length * 0.75);
          const q1 = datesAsNumbers[q1Index];
          const q3 = datesAsNumbers[q3Index];
          const iqr = q3 - q1;

          // Filter out dates that are more than 1.5 * IQR away from Q1 or Q3
          const lowerBound = q1 - 1.5 * iqr;
          const upperBound = q3 + 1.5 * iqr;

          filteredDates = allDates.filter((dateStr) => {
            const timestamp = new Date(dateStr).getTime();
            return timestamp >= lowerBound && timestamp <= upperBound;
          });
        }

        // Also apply date range filter if specified (for non-"all" ranges)
        let finalDates = filteredDates;
        if (dateFilter && dateRange !== "all") {
          const rangeStart = dateFilter.gte.getTime();
          finalDates = filteredDates.filter((dateStr) => {
            const timestamp = new Date(dateStr).getTime();
            return timestamp >= rangeStart;
          });
        } else {
          // For "all" range, we've already filtered by the 5% threshold
          finalDates = filteredDates;
        }

        if (!finalDates || finalDates.length === 0) {
          const fallbackDates = enforcedStart
            ? sortedDates.filter((dateStr) => new Date(dateStr) >= enforcedStart)
            : sortedDates;
          finalDates = fallbackDates.slice(-Math.min(fallbackDates.length, 90));
        }

        const startCandidates: Date[] = [];
        if (enforcedStart) {
          const startClone = new Date(enforcedStart);
          startClone.setUTCHours(0, 0, 0, 0);
          startCandidates.push(startClone);
        }
        if (dateFilterStart) {
          const filterStart = new Date(dateFilterStart);
          filterStart.setUTCHours(0, 0, 0, 0);
          startCandidates.push(filterStart);
        }
        if (startCandidates.length === 0 && finalDates.length > 0) {
          const firstFinal = new Date(finalDates[0]);
          firstFinal.setUTCHours(0, 0, 0, 0);
          startCandidates.push(firstFinal);
        }

        const endCandidates: Date[] = [];
        if (dateFilterEnd) {
          const filterEnd = new Date(dateFilterEnd);
          filterEnd.setUTCHours(0, 0, 0, 0);
          endCandidates.push(filterEnd);
        }
        if (finalDates.length > 0) {
          const lastFinal = new Date(finalDates[finalDates.length - 1]);
          lastFinal.setUTCHours(0, 0, 0, 0);
          endCandidates.push(lastFinal);
        }

        let paddedDates = finalDates;
        if (startCandidates.length > 0 && endCandidates.length > 0) {
          const startDate = startCandidates.reduce((latest, current) =>
            current > latest ? current : latest
          );
          const endDate = endCandidates.reduce((latest, current) =>
            current > latest ? current : latest
          );

          const normalizedStart = new Date(startDate);
          const normalizedEnd = new Date(endDate);

          if (normalizedEnd < normalizedStart) {
            normalizedEnd.setTime(normalizedStart.getTime());
          }

          const rangeDates: string[] = [];
          const cursor = new Date(normalizedStart);
          cursor.setUTCHours(0, 0, 0, 0);
          normalizedEnd.setUTCHours(0, 0, 0, 0);

          while (cursor <= normalizedEnd) {
            rangeDates.push(cursor.toISOString().split("T")[0]);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          }

          paddedDates = rangeDates;
        }

        if (paddedDates.length === 0) {
          return NextResponse.json({
            timeline: [],
            allBrands: allBrandNames,
            suppressWarning: true,
          });
        }

        // Build timeline data: array of objects with date and brand metrics
        const timelineData: Array<{
          date: string;
          [key: string]: string | number; // Dynamic keys for each brand
        }> = [];

        for (const dateKey of paddedDates) {
          const dateEntry: { date: string; [key: string]: string | number } = { date: dateKey };
          const brandMap = timelineMap.get(dateKey) ?? new Map();

          for (const brandName of brandNames) {
            const dataPoint = brandMap.get(brandName);
            if (dataPoint) {
              // For each brand, create 3 keys: mentions, positive, negative
              dateEntry[`${brandName}_mentions`] = dataPoint.mentions;
              dateEntry[`${brandName}_positive`] = dataPoint.positive;
              dateEntry[`${brandName}_negative`] = dataPoint.negative;
            } else {
              // Fill with zeros if no data for this brand on this date
              dateEntry[`${brandName}_mentions`] = 0;
              dateEntry[`${brandName}_positive`] = 0;
              dateEntry[`${brandName}_negative`] = 0;
            }
          }

          timelineData.push(dateEntry);
        }

        console.log("[BrandInsights] Timeline data points returned:", timelineData.length);

        return NextResponse.json({
          timeline: timelineData,
          allBrands: allBrandNames,
        });
      } else {
        return NextResponse.json({
          timeline: [],
          allBrands: allBrandNames,
        });
      }
    } else {
      // Original summary view logic
      // Aggregate brand mentions by sentiment
      const brandMentions: Map<string, BrandMention> = new Map();

      // Initialize counts for each brand
      for (const brandName of brandNames) {
        brandMentions.set(brandName, {
          brandName,
          totalMentions: 0,
          positive: 0,
          negative: 0,
          neutral: 0,
          mixed: 0,
        });
      }

      // Count mentions by brand and sentiment
      for (const record of brandAnalysisRecords) {
        const mention = brandMentions.get(record.brand_name);
        if (!mention) continue;

        mention.totalMentions++;
        switch (record.sentiment) {
          case "POSITIVE":
            mention.positive++;
            break;
          case "NEGATIVE":
            mention.negative++;
            break;
          case "NEUTRAL":
            mention.neutral++;
            break;
          case "MIXED":
            mention.mixed++;
            break;
          default:
            mention.neutral++;
        }
      }

      const results = Array.from(brandMentions.values());

      console.log("[BrandInsights] Returning results:", {
        totalBrands: results.length,
        brandsWithMentions: results.filter((b) => b.totalMentions > 0).length,
        brandSummaries: results.map((b) => ({
          name: b.brandName,
          total: b.totalMentions,
        })),
      });

      return NextResponse.json({
        brands: results,
        allBrands: allBrandNames,
      });
    }
  } catch (error) {
    console.error("Error fetching brand insights:", error);

    // Try to at least return the brand list even if processing failed
    try {
      const session = await auth();
      if (session?.user?.id) {
        const project = await prisma.project.findFirst({
          where: {
            id: projectId,
            user_id: session.user.id,
            deleted_at: null,
          },
          include: {
            brands: {
              where: { deleted_at: null },
              select: { brand_name: true },
            },
          },
        });

        if (project) {
          const allBrandNames = project.brands.map((b) => b.brand_name);
          return NextResponse.json({
            brands: [],
            allBrands: allBrandNames,
            error: "Failed to process brand mentions, but brands list retrieved",
          });
        }
      }
    } catch (fallbackError) {
      console.error("Error in fallback brand retrieval:", fallbackError);
    }

    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
        allBrands: [], // Always include allBrands, even on error
      },
      { status: 500 }
    );
  }
}
