"use server";

import { requireRole } from "@/lib/auth/permissions";
import { readFile } from "fs/promises";
import { join } from "path";
import { getEmailTemplateService } from "crunchycone-lib";

export interface EmailTemplate {
  id: string;
  name: string;
  description?: string;
  language: string;
  data?: Record<string, unknown>;
}

export interface TemplatePreview {
  subject: string;
  html: string;
  text: string;
}

export async function getAvailableTemplates(): Promise<{
  success: boolean;
  templates?: EmailTemplate[];
  message?: string;
}> {
  await requireRole("admin");

  try {
    // Set email provider to console temporarily
    const originalProvider = process.env.CRUNCHYCONE_EMAIL_PROVIDER;
    process.env.CRUNCHYCONE_EMAIL_PROVIDER = "console";

    try {
      const templateService = getEmailTemplateService();
      const templateMetadata = await templateService.getAvailableTemplates();

      const templates: EmailTemplate[] = templateMetadata.map((template) => {
        // Create template ID from name and first available language
        const language = template.languages?.[0] || "en";
        const templateId = `${language}/${template.name}`;

        return {
          id: templateId,
          name: template.name
            .split("-")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" "),
          description: template.description,
          language,
          data: template.dataSchema ? {} : undefined, // Will load actual data in preview
        };
      });

      return {
        success: true,
        templates: templates.sort((a, b) => a.name.localeCompare(b.name)),
      };
    } finally {
      // Restore original email provider
      if (originalProvider === undefined) {
        delete process.env.CRUNCHYCONE_EMAIL_PROVIDER;
      } else {
        process.env.CRUNCHYCONE_EMAIL_PROVIDER = originalProvider;
      }
    }
  } catch (error) {
    console.error("Failed to get available templates:", error);
    return {
      success: false,
      message: "Failed to load email templates",
    };
  }
}

export async function renderTemplatePreview(
  templateId: string,
  customData?: Record<string, unknown>
): Promise<{ success: boolean; preview?: TemplatePreview; message?: string }> {
  await requireRole("admin");

  try {
    // Set email provider to console temporarily for template rendering
    const originalProvider = process.env.CRUNCHYCONE_EMAIL_PROVIDER;
    process.env.CRUNCHYCONE_EMAIL_PROVIDER = "console";

    try {
      const templateService = getEmailTemplateService();

      // Load template data if no custom data provided
      let templateData = customData;
      if (!templateData) {
        const [language, templateName] = templateId.split("/");
        const dataPath = join(
          process.cwd(),
          "templates",
          "email",
          language,
          templateName,
          "data-preview.json"
        );
        try {
          const dataContent = await readFile(dataPath, "utf8");
          templateData = JSON.parse(dataContent);
        } catch {
          templateData = {};
        }
      }

      // Use the previewTemplate method
      const [language, templateName] = templateId.split("/");
      const rendered = await templateService.previewTemplate(
        templateName,
        templateData || {},
        language
      );

      return {
        success: true,
        preview: {
          subject: rendered.subject || "No subject",
          html: rendered.html || "",
          text: rendered.text || "",
        },
      };
    } finally {
      // Restore original email provider
      if (originalProvider === undefined) {
        delete process.env.CRUNCHYCONE_EMAIL_PROVIDER;
      } else {
        process.env.CRUNCHYCONE_EMAIL_PROVIDER = originalProvider;
      }
    }
  } catch (error) {
    console.error("Failed to render template preview:", error);
    return {
      success: false,
      message: `Failed to render template: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
