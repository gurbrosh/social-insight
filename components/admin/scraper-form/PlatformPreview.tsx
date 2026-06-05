"use client";

import { useState, useEffect } from "react";

interface PlatformPreviewProps {
  projectId: string;
  keywords: string[];
  platform: "reddit" | "x" | "linkedin";
}

interface PlatformConfig {
  endpoint: string;
  icon: string;
  title: string;
  keywordColor: string;
  urlColor: string;
  combinedColor: string;
  errorMessage: string;
  noUrlsMessage: string;
  loadingMessage: string;
  fallbackMessage: string;
}

const PLATFORM_CONFIGS: Record<string, PlatformConfig> = {
  reddit: {
    endpoint: "/api/admin/projects",
    icon: "🔗",
    title: "Reddit Scraper Combined Input Preview",
    keywordColor: "green",
    urlColor: "blue",
    combinedColor: "purple",
    errorMessage: "Failed to load Reddit URLs",
    noUrlsMessage: "No Reddit URLs found in project profiles",
    loadingMessage: "Loading Reddit URLs...",
    fallbackMessage:
      "The Reddit scraper will still work with project selection, but Reddit profile URLs couldn't be loaded.",
  },
  x: {
    endpoint: "/api/admin/projects",
    icon: "🐦",
    title: "X Scraper Combined Input Preview",
    keywordColor: "blue",
    urlColor: "purple",
    combinedColor: "blue",
    errorMessage: "Failed to load X profiles",
    noUrlsMessage: "No X URLs configured",
    loadingMessage: "Loading X URLs...",
    fallbackMessage:
      "The X scraper will still work with project selection, but X profile URLs couldn't be loaded.",
  },
  linkedin: {
    endpoint: "/api/admin/projects",
    icon: "💼",
    title: "LinkedIn Scraper Combined Input Preview",
    keywordColor: "blue",
    urlColor: "blue",
    combinedColor: "blue",
    errorMessage: "Failed to load LinkedIn profiles",
    noUrlsMessage: "No LinkedIn URLs configured",
    loadingMessage: "Loading LinkedIn URLs...",
    fallbackMessage:
      "The LinkedIn scraper will still work with project selection, but LinkedIn profile URLs couldn't be loaded.",
  },
};

export function PlatformPreview({ projectId, keywords, platform }: PlatformPreviewProps) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const config = PLATFORM_CONFIGS[platform];

  useEffect(() => {
    async function fetchUrls() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${config.endpoint}/${projectId}/${platform}-urls`, {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const data = await response.json();
          setUrls(data.urls || []);
        } else if (response.status === 401) {
          setError("Please log in to view profiles");
        } else if (response.status === 403) {
          setError("Admin access required to view profiles");
        } else {
          setError(config.errorMessage);
        }
      } catch {
        setError(config.errorMessage);
        setUrls([]);
      } finally {
        setLoading(false);
      }
    }

    if (projectId) {
      fetchUrls();
    }
  }, [projectId, platform, config]);

  const combinedInputs = [...keywords, ...urls];

  return (
    <div className="p-4 border rounded-lg bg-muted/50">
      <h4 className="font-medium mb-3 flex items-center gap-2">
        {config.icon} {config.title}
      </h4>

      {loading ? (
        <div className="text-sm text-muted-foreground">{config.loadingMessage}</div>
      ) : error ? (
        <div className="space-y-3">
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</div>
          <div className="text-sm text-muted-foreground">
            💡 {config.fallbackMessage}
            The scraper will use the project&apos;s {platform} profiles from the database directly.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className={`text-sm font-medium text-${config.keywordColor}-600 mb-2`}>
                Keywords ({keywords.length})
              </div>
              <div className="text-sm text-muted-foreground">
                {keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {keywords.map((keyword, index) => (
                      <span
                        key={index}
                        className={`px-2 py-1 bg-${config.keywordColor}-100 text-${config.keywordColor}-800 rounded text-xs`}
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                ) : (
                  "No keywords selected"
                )}
              </div>
            </div>

            <div>
              <div className={`text-sm font-medium text-${config.urlColor}-600 mb-2`}>
                {platform.charAt(0).toUpperCase() + platform.slice(1)} URLs ({urls.length})
              </div>
              <div className="text-sm text-muted-foreground">
                {urls.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {urls.map((url, index) => (
                      <span
                        key={index}
                        className={`px-2 py-1 bg-${config.urlColor}-100 text-${config.urlColor}-800 rounded text-xs ${url.startsWith("http") ? "break-all" : ""}`}
                      >
                        {url}
                      </span>
                    ))}
                  </div>
                ) : (
                  config.noUrlsMessage
                )}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t">
            <div className={`text-sm font-medium text-${config.combinedColor}-600 mb-2`}>
              Combined Input ({combinedInputs.length} total)
            </div>
            <div className="text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-1">
                {combinedInputs.map((input, index) => (
                  <span
                    key={index}
                    className={`px-2 py-1 rounded text-xs ${
                      input.startsWith("http")
                        ? `bg-${config.urlColor}-100 text-${config.urlColor}-800`
                        : `bg-${config.keywordColor}-100 text-${config.keywordColor}-800`
                    }`}
                  >
                    {input}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            💡 The {platform} scraper will receive all {combinedInputs.length} items as input,
            treating both keywords and URLs the same way.
          </div>
        </div>
      )}
    </div>
  );
}
