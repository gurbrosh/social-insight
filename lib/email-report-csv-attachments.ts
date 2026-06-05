import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getStoredNetworkAnalysisForUser } from "@/app/actions/network-analysis";
import { getStoredChatterAnalysisForUser } from "@/app/actions/chatter-analysis";
import { getStoredThemesAnalysisForUser } from "@/app/actions/themes-analysis";
import { prisma } from "@/lib/prisma";
import {
  buildChatterCsvContent,
  buildInfluencersCsvContent,
  buildNewsCsvContent,
} from "@/lib/report-sections-export-csv";
import { buildThemesCsvContent, dedupeThemeMatchesForExport } from "@/lib/themes-export-csv";

export type EmailReportCsvAttachment = {
  filename: string;
  content: Buffer;
};

function slugifyThemeName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "theme"
  );
}

/**
 * Builds the same CSV payloads as the signed export routes (report window + user scope).
 * Used for dev email attachments and optional disk fallback when SMTP is not configured.
 */
export async function buildEmailReportCsvAttachments(params: {
  projectId: string;
  userId: string;
  windowStart: Date;
  themes: { id: string; theme_name: string }[];
}): Promise<EmailReportCsvAttachment[]> {
  const { projectId, userId, windowStart, themes } = params;
  const dateStr = new Date().toISOString().slice(0, 10);
  const short = projectId.slice(-8);
  const out: EmailReportCsvAttachment[] = [];

  const net = await getStoredNetworkAnalysisForUser(projectId, userId, {
    latestPostAfter: windowStart,
    limit: 10000,
    dateRange: "all",
    minReactions: 10,
  });
  if (net.success && net.people) {
    out.push({
      filename: `influencers-${short}-${dateStr}.csv`,
      content: Buffer.from(buildInfluencersCsvContent(net.people), "utf-8"),
    });
  }

  const newsRows = await prisma.postNews.findMany({
    where: {
      project_id: projectId,
      deleted_at: null,
      OR: [
        { date_range_start: { gte: windowStart } },
        { AND: [{ date_range_start: null }, { created_at: { gte: windowStart } }] },
      ],
    },
    orderBy: { created_at: "desc" },
  });

  const newsItems = newsRows.map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    content: n.content,
    sentiment: n.sentiment,
    importance_score: n.importance_score,
    source_url: n.source_url,
    date_range_start: n.date_range_start,
    date_range_end: n.date_range_end,
    created_at: n.created_at,
    sources: n.sources,
  }));

  out.push({
    filename: `news-${short}-${dateStr}.csv`,
    content: Buffer.from(buildNewsCsvContent(newsItems), "utf-8"),
  });

  const chatter = await getStoredChatterAnalysisForUser(projectId, userId, {
    lastPostAfter: windowStart,
    limit: 10000,
    dateRange: "all",
  });
  if (chatter.success && chatter.conversations) {
    out.push({
      filename: `chatter-${short}-${dateStr}.csv`,
      content: Buffer.from(buildChatterCsvContent(chatter.conversations), "utf-8"),
    });
  }

  for (const t of themes) {
    const themeResult = await getStoredThemesAnalysisForUser(projectId, userId, {
      themeId: t.id,
      postedAfter: windowStart,
      minRelevance: 50,
      limit: 10000,
      dateRange: "all",
    });
    if (!themeResult.success || !themeResult.matches) {
      continue;
    }
    const slug = slugifyThemeName(t.theme_name);
    const csv = buildThemesCsvContent(dedupeThemeMatchesForExport(themeResult.matches));
    out.push({
      filename: `theme-${slug}-${t.id.slice(-6)}-${dateStr}.csv`,
      content: Buffer.from(csv, "utf-8"),
    });
  }

  return out;
}

export function hasSmtpConfigForDevAttachments(): boolean {
  return Boolean(
    process.env.CRUNCHYCONE_SMTP_HOST &&
      process.env.CRUNCHYCONE_SMTP_USER &&
      process.env.CRUNCHYCONE_SMTP_PASS &&
      process.env.CRUNCHYCONE_SMTP_FROM
  );
}

export async function writeEmailReportCsvAttachmentsToTemp(
  attachments: EmailReportCsvAttachment[]
): Promise<string> {
  const dir = join(tmpdir(), `social-insight-email-report-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  for (const a of attachments) {
    await writeFile(join(dir, a.filename), a.content);
  }
  return dir;
}
