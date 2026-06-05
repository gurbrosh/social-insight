"use server";

import { revalidatePath } from "next/cache";
import { createEmailService } from "crunchycone-lib";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStoredThemesAnalysisForUser } from "@/app/actions/themes-analysis";
import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";
import {
  buildEmailReportCsvAttachments,
  hasSmtpConfigForDevAttachments,
  writeEmailReportCsvAttachmentsToTemp,
} from "@/lib/email-report-csv-attachments";
import { sendEmailWithSmtpAttachments } from "@/lib/send-email-smtp-with-attachments";
import {
  buildEmailReportDetailSections,
  EMAIL_FONT,
  EMAIL_SIZE,
  escapeHtml,
} from "@/lib/email-report-body";
import { getRollingWindowStart } from "@/lib/report-window";

const EMAIL_REPORTS_CATEGORY = "email_reports";

export type EmailReportRangeUnit = "days" | "weeks" | "months";

export type EmailReportSettings = {
  projectId: string;
  rangeAmount: number;
  rangeUnit: EmailReportRangeUnit;
  recipients: string[];
  /** 0–100. Theme + generated-response relevance; 0 = no extra threshold. */
  linkedinProspectsMinRelevancePercent: number;
};

const settingsSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  rangeAmount: z.coerce.number().int().min(1).max(31),
  rangeUnit: z.enum(["days", "weeks", "months"]),
  recipients: z
    .array(z.string())
    .transform((arr) => arr.map((s) => s.trim()).filter((s) => s.length > 0))
    .pipe(z.array(z.string().email("Invalid email address")).min(1, "Add at least one recipient")),
  linkedinProspectsMinRelevancePercent: z.coerce.number().int().min(0).max(100).default(80),
});

export async function getEmailReportSettings(): Promise<
  | {
      ok: true;
      settings: EmailReportSettings | null;
    }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const row = await prisma.appConfig.findFirst({
    where: {
      category: EMAIL_REPORTS_CATEGORY,
      key: session.user.id,
      deleted_at: null,
    },
  });

  if (!row || row.data_type !== "object") {
    return { ok: true, settings: null };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(row.value);
  } catch {
    return { ok: true, settings: null };
  }

  if (raw == null || typeof raw !== "object") {
    return { ok: true, settings: null };
  }

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: true, settings: null };
  }

  return { ok: true, settings: parsed.data };
}

export async function saveEmailReportSettings(
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "_root";
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    return { ok: false, error: "Validation failed", fieldErrors };
  }

  const { projectId, rangeAmount, rangeUnit, recipients, linkedinProspectsMinRelevancePercent } =
    parsed.data;

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user_id: session.user.id,
      deleted_at: null,
    },
    select: { id: true },
  });

  if (!project) {
    return { ok: false, error: "Project not found or access denied" };
  }

  const payload: EmailReportSettings = {
    projectId,
    rangeAmount,
    rangeUnit,
    recipients: recipients.map((e) => e.trim().toLowerCase()),
    linkedinProspectsMinRelevancePercent,
  };

  const success = await configService.setConfig(
    EMAIL_REPORTS_CATEGORY,
    session.user.id,
    payload,
    "object",
    {
      description: "Email report delivery preferences for the workspace user",
      displayName: `Email reports (${session.user.id})`,
    }
  );

  if (!success) {
    return { ok: false, error: "Failed to save configuration" };
  }

  revalidatePath("/reports/email");
  return { ok: true };
}

function getReportWindowStart(rangeAmount: number, rangeUnit: EmailReportRangeUnit): Date {
  return getRollingWindowStart(rangeAmount, rangeUnit, new Date());
}

function formatReportRangeLabel(rangeAmount: number, rangeUnit: EmailReportRangeUnit): string {
  if (rangeUnit === "days") {
    return rangeAmount === 1 ? "1 day" : `${rangeAmount} days`;
  }
  if (rangeUnit === "weeks") {
    return rangeAmount === 1 ? "1 week" : `${rangeAmount} weeks`;
  }
  return rangeAmount === 1 ? "1 month" : `${rangeAmount} months`;
}

export async function sendEmailReport(
  input: unknown
): Promise<{ ok: true; recipientCount: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthorized" };
  }

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid input";
    return { ok: false, error: first };
  }

  const { projectId, rangeAmount, rangeUnit, recipients } = parsed.data;
  const normalizedRecipients = recipients.map((e) => e.trim().toLowerCase());
  /** One send per address — some providers/API paths do not deliver to every address in a multi-recipient `to` list. */
  const uniqueRecipients = [...new Set(normalizedRecipients)];

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user_id: session.user.id,
      deleted_at: null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      monitoring_focus: true,
      my_product_name: true,
      my_product_focus_text: true,
      my_product_summary_json: true,
      schedule_timezone: true,
    },
  });

  if (!project) {
    return { ok: false, error: "Project not found or access denied" };
  }

  const windowStart = getReportWindowStart(rangeAmount, rangeUnit);
  const userId = session.user.id;
  const minNetworkReactions = 10;

  const [
    postCount,
    keywordRows,
    brandRows,
    conversationCount,
    influencerCount,
    newsCount,
    chatterCount,
    themesResult,
    projectThemes,
    detailSections,
  ] = await Promise.all([
    prisma.post.count({
      where: {
        project_id: projectId,
        createdAt: { gte: windowStart },
        isTest: false,
      },
    }),
    prisma.projectKeyword.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { keyword: true },
      orderBy: { keyword: "asc" },
    }),
    prisma.projectBrand.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { brand_name: true },
      orderBy: { brand_name: "asc" },
    }),
    prisma.conversation.count({
      where: {
        project_id: projectId,
        deleted_at: null,
        rootPost: { createdAt: { gte: windowStart } },
      },
    }),
    prisma.networkAnalysis.count({
      where: {
        project_id: projectId,
        deleted_at: null,
        OR: [
          { platform: { in: ["discord", "Discord"] } },
          { total_reactions: { gte: minNetworkReactions } },
        ],
        latest_post_at: { gte: windowStart },
      },
    }),
    prisma.postNews.count({
      where: {
        project_id: projectId,
        deleted_at: null,
        OR: [
          { date_range_start: { gte: windowStart } },
          { AND: [{ date_range_start: null }, { created_at: { gte: windowStart } }] },
        ],
      },
    }),
    prisma.chatterAnalysis.count({
      where: {
        project_id: projectId,
        deleted_at: null,
        last_post_at: { gte: windowStart },
      },
    }),
    getStoredThemesAnalysisForUser(projectId, userId, {
      postedAfter: windowStart,
      minRelevance: 50,
      limit: 10000,
      dateRange: "all",
    }),
    prisma.projectTheme.findMany({
      where: { project_id: projectId, deleted_at: null, is_active: true },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        theme_name: true,
      },
    }),
    buildEmailReportDetailSections({
      projectId,
      userId,
      windowStart,
      project,
    }),
  ]);

  if (!themesResult.success) {
    return { ok: false, error: themesResult.error || "Failed to load theme analysis" };
  }

  const totalThemeMatches = themesResult.totalMatches ?? 0;

  const fromEmail =
    process.env.CRUNCHYCONE_EMAIL_FROM || process.env.EMAIL_FROM || "noreply@crunchycone.app";
  const fromName =
    process.env.CRUNCHYCONE_EMAIL_FROM_DISPLAY ||
    process.env.NEXT_PUBLIC_APP_NAME ||
    "Email report";

  const rangeLabel = formatReportRangeLabel(rangeAmount, rangeUnit);
  const periodStartStr = windowStart.toISOString().slice(0, 10);
  const periodEndStr = new Date().toISOString().slice(0, 10);

  const keywordsText = keywordRows.map((k) => k.keyword).join(", ") || "—";
  const brandsText = brandRows.map((b) => b.brand_name).join(", ") || "—";

  const html = `
<div style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};line-height:1.5;color:#111;max-width:720px;margin:0 auto;">
  <h2 style="font-family:${EMAIL_FONT};font-size:20px;font-weight:600;line-height:1.25;color:#111;margin:0 0 12px 0;">Project report</h2>
  <p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};line-height:1.5;color:#111;margin:0 0 16px 0;">This report summarizes listening activity for <strong style="font-family:${EMAIL_FONT};font-weight:600;">${escapeHtml(project.name)}</strong> over the <strong style="font-family:${EMAIL_FONT};font-weight:600;">${escapeHtml(rangeLabel)}</strong> ending ${escapeHtml(periodEndStr)} (window starts ${escapeHtml(periodStartStr)}).</p>
  <p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};line-height:1.5;color:#111;margin:0 0 8px 0;"><strong style="font-family:${EMAIL_FONT};font-weight:600;">Keywords:</strong> ${escapeHtml(keywordsText)}</p>
  <p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};line-height:1.5;color:#111;margin:0 0 8px 0;"><strong style="font-family:${EMAIL_FONT};font-weight:600;">Brands:</strong> ${escapeHtml(brandsText)}</p>
  <p style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};line-height:1.5;color:#111;margin:0 0 8px 0;"><strong style="font-family:${EMAIL_FONT};font-weight:600;">Time scope:</strong> ${escapeHtml(rangeLabel)}</p>
  <ul style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};line-height:1.5;color:#111;margin:12px 0;padding-left:20px;">
    <li style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};margin:4px 0;">Posts in scope: ${postCount}</li>
    <li style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};margin:4px 0;">Conversations recorded: ${conversationCount}</li>
    <li style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};margin:4px 0;">Influencers: ${influencerCount}</li>
    <li style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};margin:4px 0;">News items: ${newsCount}</li>
    <li style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};margin:4px 0;">Chatter items: ${chatterCount}</li>
    <li style="font-family:${EMAIL_FONT};font-size:${EMAIL_SIZE};margin:4px 0;">Theme matches (deduplicated): ${totalThemeMatches}</li>
  </ul>
  ${detailSections.html}
</div>`.trim();

  const text = [
    `Project report`,
    ``,
    `Project: ${project.name}`,
    `Keywords: ${keywordsText}`,
    `Brands: ${brandsText}`,
    `Time scope: ${rangeLabel} (from ${periodStartStr} through ${periodEndStr})`,
    ``,
    `Posts in scope: ${postCount}`,
    `Conversations recorded: ${conversationCount}`,
    `Influencers: ${influencerCount}`,
    `News items: ${newsCount}`,
    `Chatter items: ${chatterCount}`,
    `Theme matches (deduplicated): ${totalThemeMatches}`,
    ``,
    detailSections.text,
  ].join("\n");

  const shouldAttachDevCsvs =
    process.env.NODE_ENV === "development" && process.env.EMAIL_REPORT_ATTACH_CSVS !== "0";

  let csvAttachments: Awaited<ReturnType<typeof buildEmailReportCsvAttachments>> = [];
  if (shouldAttachDevCsvs) {
    try {
      csvAttachments = await buildEmailReportCsvAttachments({
        projectId: project.id,
        userId,
        windowStart,
        themes: projectThemes.map((t) => ({ id: t.id, theme_name: t.theme_name })),
      });
    } catch (attachErr) {
      console.error("[email-report] Failed to build CSV attachments:", attachErr);
    }
  }

  const emailProvider = process.env.CRUNCHYCONE_EMAIL_PROVIDER?.trim().toLowerCase() || "console";
  const useSmtpAttachmentSend =
    shouldAttachDevCsvs &&
    csvAttachments.length > 0 &&
    hasSmtpConfigForDevAttachments() &&
    (emailProvider === "smtp" || process.env.EMAIL_REPORT_ATTACH_VIA_SMTP === "1");

  try {
    if (useSmtpAttachmentSend) {
      for (const email of uniqueRecipients) {
        const smtpResult = await sendEmailWithSmtpAttachments({
          from: { email: fromEmail, name: fromName },
          to: [email],
          subject: `Report: ${project.name} (${rangeLabel})`,
          htmlBody: html,
          textBody: text,
          attachments: csvAttachments,
        });
        if (!smtpResult.success) {
          console.error(`[email-report] SMTP send failed for ${email}:`, smtpResult.error);
          try {
            const dir = await writeEmailReportCsvAttachmentsToTemp(csvAttachments);
            console.log(
              `[email-report] ${csvAttachments.length} CSV file(s) saved after SMTP failure: ${dir}`
            );
          } catch (writeErr) {
            console.error("[email-report] Could not write CSV temp files:", writeErr);
          }
          return {
            ok: false,
            error: `${smtpResult.error || "SMTP error"} (recipient: ${email})`,
          };
        }
      }
      console.log(
        `[email-report] Sent ${uniqueRecipients.length} message(s) with ${csvAttachments.length} CSV attachment(s) via SMTP.`
      );
      return { ok: true, recipientCount: uniqueRecipients.length };
    }
    if (shouldAttachDevCsvs && csvAttachments.length > 0) {
      try {
        const dir = await writeEmailReportCsvAttachmentsToTemp(csvAttachments);
        const hint =
          emailProvider !== "smtp" && process.env.EMAIL_REPORT_ATTACH_VIA_SMTP !== "1"
            ? " Set CRUNCHYCONE_EMAIL_PROVIDER=smtp (or EMAIL_REPORT_ATTACH_VIA_SMTP=1) to attach the same files via SMTP."
            : "";
        console.log(`[email-report] ${csvAttachments.length} CSV file(s) saved: ${dir}.${hint}`);
      } catch (writeErr) {
        console.error("[email-report] Could not write CSV temp files:", writeErr);
      }
    }

    console.log(
      `[email-report] Sending report to ${uniqueRecipients.length} recipient(s): ${uniqueRecipients.join(", ")}`
    );

    const emailService = createEmailService();
    for (const email of uniqueRecipients) {
      const result = await emailService.sendEmail({
        from: {
          email: fromEmail,
          name: fromName,
        },
        to: [{ email, name: "" }],
        subject: `Report: ${project.name} (${rangeLabel})`,
        htmlBody: html,
        textBody: text,
      });

      if (!result.success) {
        return {
          ok: false,
          error: `${result.error || "Failed to send email"} (recipient: ${email})`,
        };
      }
    }

    console.log("[email-report] Sent successfully to all recipients (one message per address).");
    return { ok: true, recipientCount: uniqueRecipients.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send email";
    return { ok: false, error: message };
  }
}
