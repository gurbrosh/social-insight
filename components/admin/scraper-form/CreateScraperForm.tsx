"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { toast } from "@/hooks/use-toast";
import { validateScraperConfigJson } from "@/lib/scraper-config-validator";
import { BasicInformationCard } from "./BasicInformationCard";
import { InputTypeConfigurationCard } from "./InputTypeConfigurationCard";
import { ConfigurationCard } from "./ConfigurationCard";
import { TestConfigurationCard } from "./TestConfigurationCard";
import { ScraperFormData, CreateScraperFormProps } from "./types";

export function CreateScraperForm({ scraper }: CreateScraperFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testKeywords, setTestKeywords] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [saveTestResults, setSaveTestResults] = useState(false);

  const [formData, setFormData] = useState<ScraperFormData>({
    name: scraper?.name || "",
    descriptive_name: scraper?.descriptive_name || "",
    actor_id: scraper?.actor_id || "",
    readme_url: scraper?.readme_url || "",
    platform: scraper?.platform || "",
    config_json:
      scraper?.config_json ||
      (scraper?.platform === "discord"
        ? `{
  "action": "scrapeMessages",
  "count": 50,
  "maxDelay": 3,
  "minDelay": 1,
  "scrapeChannelMembers.channelUrl": [user_selected_discord_urls],
  "scrapeMessages.channelUrl": [user_selected_discord_urls],
  "token": "YOUR_DISCORD_BOT_TOKEN"
}`
        : `{
  "startUrls": [],
  "maxResults": 100,
  "includeComments": false,
  "includeReplies": false
}`),
    is_active: scraper?.is_active ?? true,
    save_to_db: scraper?.save_to_db ?? true,
    input_type: scraper?.input_type || "array",
    run_iteratively: scraper?.run_iteratively ?? true,
    url_input_field_name: scraper?.url_input_field_name || "",
    url_input_source_scraper: scraper?.url_input_source_scraper || "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Automatically enable saveTestResults for Discord scrapers
  useEffect(() => {
    if (formData.platform === "discord") {
      setSaveTestResults(true);
    }
  }, [formData.platform]);

  // Update config_json when platform changes to Discord
  useEffect(() => {
    if (formData.platform === "discord" && !scraper?.config_json) {
      setFormData((prev) => ({
        ...prev,
        config_json: `{
  "action": "scrapeMessages",
  "count": 50,
  "maxDelay": 3,
  "minDelay": 1,
  "scrapeChannelMembers.channelUrl": [user_selected_discord_urls],
  "scrapeMessages.channelUrl": [user_selected_discord_urls],
  "token": "YOUR_DISCORD_BOT_TOKEN"
}`,
      }));
    }
  }, [formData.platform, scraper?.config_json]);

  const updateFormData = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const validateForm = (): { valid: boolean; firstMessage: string } => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Please enter a name for the scraper.";
    }

    if (!formData.actor_id.trim()) {
      newErrors.actor_id = "Please enter the Actor ID.";
    }

    if (!formData.platform.trim()) {
      newErrors.platform = "Please select a platform (e.g. YouTube, Website).";
    }

    if (!formData.config_json.trim()) {
      newErrors.config_json = "Please add JSON configuration.";
    } else {
      const result = validateScraperConfigJson(formData.config_json);
      if (!result.ok) {
        newErrors.config_json = result.error;
      }
    }

    setErrors(newErrors);
    const firstMessage = Object.values(newErrors)[0] ?? "Please fix the errors below.";
    return { valid: Object.keys(newErrors).length === 0, firstMessage };
  };

  const testScraper = async () => {
    const { valid, firstMessage } = validateForm();
    if (!valid) {
      toast({
        title: "Can't test",
        description: firstMessage,
        variant: "destructive",
      });
      return;
    }

    // Only require project selection if we're using keywords OR saving test results
    const hasUrlInputConfig = formData.url_input_field_name && formData.url_input_source_scraper;
    const usingKeywords = testKeywords.length > 0;

    if (!selectedProjectId && (usingKeywords || saveTestResults)) {
      toast({
        title: "No Project Selected",
        description: "Please select a project to choose keywords from or to save test results.",
        variant: "destructive",
      });
      return;
    }

    // Check if we have either keywords OR URL input configuration OR it's a Discord scraper OR it's an X scraper with project selected

    if (
      testKeywords.length === 0 &&
      !hasUrlInputConfig &&
      formData.platform !== "discord" &&
      !(formData.platform === "x" && selectedProjectId) &&
      !(formData.platform === "linkedin" && selectedProjectId)
    ) {
      toast({
        title: "No Test Input",
        description:
          "Please select keywords to test with OR configure URL input from downstream scraper OR select a project for X/LinkedIn scrapers.",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await fetch("/api/admin/scrapers/test", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name,
          actor_id: formData.actor_id,
          platform: formData.platform,
          config_json: formData.config_json,
          save_to_db: formData.save_to_db,
          url_input_field_name: formData.url_input_field_name,
          url_input_source_scraper: formData.url_input_source_scraper,
          testInput: {
            keywords: testKeywords,
          },
          saveTestResults: saveTestResults,
          projectId: selectedProjectId || (hasUrlInputConfig ? null : undefined),
        }),
      });

      const data = await response.json();
      setTestResult(data);

      if (data.success) {
        const saveMessage = saveTestResults
          ? " Test results have been saved to the database."
          : " Test results were not saved to the database.";
        toast({
          title: "Test Successful",
          description: `Found ${data.totalItems || data.results?.length || 0} items. Scraper is working correctly.${saveMessage}`,
        });
      } else {
        toast({
          title: "Test Failed",
          description: data.error || "Unknown error occurred.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Test Error",
        description: "Failed to test scraper. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { valid, firstMessage } = validateForm();
    if (!valid) {
      toast({
        title: "Can't save",
        description: firstMessage,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const url = scraper ? `/api/admin/scrapers/${scraper.id}` : "/api/admin/scrapers";
      const method = scraper ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || `Failed to ${scraper ? "update" : "create"} scraper`;
        console.error("[Scraper save failed]", {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error,
          details: errorData.details,
          fullBody: errorData,
        });
        const newErrors: Record<string, string> = {};
        if (errorData.details && Array.isArray(errorData.details)) {
          for (const issue of errorData.details) {
            const field = issue.path?.[0];
            if (field && typeof field === "string") {
              newErrors[field] = issue.message || errorMessage;
            }
          }
        }
        // When server returns a config/JSON error without details, show it on config_json
        const isConfigError =
          !errorData.details?.length &&
          typeof errorData.error === "string" &&
          (errorData.error.toLowerCase().includes("json") ||
            errorData.error.toLowerCase().includes("config") ||
            errorData.error.toLowerCase().includes("configuration"));
        if (isConfigError) {
          newErrors.config_json = errorData.error;
        }
        if (Object.keys(newErrors).length > 0) {
          setErrors((prev) => ({ ...prev, ...newErrors }));
        }
        throw new Error(errorMessage);
      }

      await response.json();

      toast({
        title: scraper ? "Scraper Updated" : "Scraper Created",
        description: `Your scraper has been ${scraper ? "updated" : "created"} successfully.`,
      });

      router.push("/admin/scrapers");
    } catch (error) {
      console.error("[Scraper save error]", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : `Failed to ${scraper ? "update" : "create"} scraper. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/scrapers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Scrapers
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">{scraper ? "Edit Scraper" : "Create New Scraper"}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <BasicInformationCard formData={formData} errors={errors} onUpdate={updateFormData} />

          <InputTypeConfigurationCard formData={formData} onUpdate={updateFormData} />
        </div>

        <ConfigurationCard formData={formData} errors={errors} onUpdate={updateFormData} />

        <TestConfigurationCard
          formData={formData}
          selectedProjectId={selectedProjectId}
          onProjectChange={setSelectedProjectId}
          testKeywords={testKeywords}
          onKeywordsChange={setTestKeywords}
          saveTestResults={saveTestResults}
          onSaveTestResultsChange={setSaveTestResults}
          onTestScraper={testScraper}
          isTesting={isTesting}
          testResult={testResult}
        />

        {/* Submit Buttons */}
        <div className="flex justify-end space-x-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/admin/scrapers">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? scraper
                ? "Updating..."
                : "Creating..."
              : scraper
                ? "Update Scraper"
                : "Create Scraper"}
          </Button>
        </div>
      </form>
    </div>
  );
}
