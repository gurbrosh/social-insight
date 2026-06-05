import nodemailer from "nodemailer";
import { formatEmailForSMTP } from "crunchycone-lib";
import type { EmailReportCsvAttachment } from "@/lib/email-report-csv-attachments";

/**
 * Sends via nodemailer using the same CRUNCHYCONE_SMTP_* env vars as crunchycone-lib’s SMTP provider.
 * Used when development report emails need real MIME attachments (console/resend providers do not).
 */
export async function sendEmailWithSmtpAttachments(params: {
  from: { email: string; name: string };
  to: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments: EmailReportCsvAttachment[];
}): Promise<{ success: boolean; error?: string }> {
  const host = process.env.CRUNCHYCONE_SMTP_HOST?.trim() || "";
  const port = parseInt(process.env.CRUNCHYCONE_SMTP_PORT || "587", 10);
  const user = process.env.CRUNCHYCONE_SMTP_USER?.trim() || "";
  const pass = process.env.CRUNCHYCONE_SMTP_PASS || "";
  const envFrom = process.env.CRUNCHYCONE_SMTP_FROM?.trim() || "";

  if (!host || !user || !pass) {
    return { success: false, error: "SMTP is not fully configured for attachments" };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const fromEmail = params.from.email?.trim() || envFrom;
  if (!fromEmail) {
    return { success: false, error: "No from address (set CRUNCHYCONE_SMTP_FROM or email env)" };
  }

  const fromHeader = formatEmailForSMTP({
    email: fromEmail,
    name: params.from.name?.trim() || undefined,
  });
  const toHeader = params.to.map((email) => formatEmailForSMTP({ email: email.trim() })).join(", ");

  try {
    await transporter.sendMail({
      from: fromHeader,
      to: toHeader,
      subject: params.subject,
      text: params.textBody,
      html: params.htmlBody,
      attachments: params.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: "text/csv; charset=utf-8",
      })),
    });
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to send email with attachments",
    };
  }
}
