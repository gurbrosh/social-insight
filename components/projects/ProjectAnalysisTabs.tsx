"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ProjectResults } from "@/components/projects/ProjectResults";
import { NewsAnalysis } from "@/components/projects/NewsAnalysis";
import { ThemesAnalysis } from "@/components/projects/ThemesAnalysis";
import { NetworkAnalysis } from "@/components/projects/NetworkAnalysis";
import { ChatterAnalysis } from "@/components/projects/ChatterAnalysis";
import { ChatAnalysis } from "@/components/projects/ChatAnalysis";

interface ProjectAnalysisTabsProps {
  projectId: string;
}

const SOURCE_SECTIONS: {
  id: string;
  title: string;
  keys: string[];
  sources: { key: string; label: string }[];
}[] = [
  {
    id: "social",
    title: "Social",
    keys: ["facebook", "linkedin", "x", "youtube"],
    sources: [
      { key: "facebook", label: "Facebook" },
      { key: "linkedin", label: "LinkedIn" },
      { key: "x", label: "X (Twitter)" },
      { key: "youtube", label: "YouTube" },
    ],
  },
  {
    id: "forums",
    title: "Forums",
    keys: ["reddit", "discord", "hackernews", "github"],
    sources: [
      { key: "reddit", label: "Reddit" },
      { key: "discord", label: "Discord" },
      { key: "hackernews", label: "Hacker News" },
      { key: "github", label: "GitHub" },
    ],
  },
  {
    id: "news",
    title: "News",
    keys: ["blog"],
    sources: [{ key: "blog", label: "Blogs" }],
  },
];

const DEFAULT_SOURCE_KEYS = SOURCE_SECTIONS.flatMap((s) => s.keys);

const VALID_ANALYSIS_TABS = new Set(["results", "network", "news", "chatter", "themes", "chat"]);

export function ProjectAnalysisTabs({ projectId }: ProjectAnalysisTabsProps) {
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const initialTab = tabFromUrl && VALID_ANALYSIS_TABS.has(tabFromUrl) ? tabFromUrl : "results";
  const [analysisTab, setAnalysisTab] = useState(initialTab);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && VALID_ANALYSIS_TABS.has(t)) {
      setAnalysisTab(t);
    }
  }, [searchParams]);

  const [dateRangeMode, setDateRangeMode] = useState<"all" | "days">("all");
  const [daysInput, setDaysInput] = useState("7");

  const dateRange = useMemo(() => {
    if (dateRangeMode === "all") {
      return "all";
    }
    const n = parseInt(daysInput, 10);
    const days = Number.isFinite(n) && n > 0 ? Math.min(3650, n) : 7;
    return `days:${days}`;
  }, [dateRangeMode, daysInput]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([...DEFAULT_SOURCE_KEYS]);
  const [languageFilter, setLanguageFilter] = useState("all"); // "all" or "en"

  const handleSourceToggle = (source: string) => {
    setSourceFilter((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
    );
  };

  const handleSectionToggle = (sectionKeys: string[]) => {
    setSourceFilter((prev) => {
      const allSelected = sectionKeys.every((k) => prev.includes(k));
      if (allSelected) {
        return prev.filter((s) => !sectionKeys.includes(s));
      }
      const next = new Set(prev);
      sectionKeys.forEach((k) => next.add(k));
      return Array.from(next);
    });
  };

  const allSourcesEnabled = DEFAULT_SOURCE_KEYS.every((k) => sourceFilter.includes(k));
  const noSourcesEnabled = DEFAULT_SOURCE_KEYS.every((k) => !sourceFilter.includes(k));
  const sourcesMasterChecked: boolean | "indeterminate" = allSourcesEnabled
    ? true
    : noSourcesEnabled
      ? false
      : "indeterminate";

  const handleSourcesMasterToggle = (checked: boolean | "indeterminate") => {
    if (checked === true) {
      setSourceFilter([...DEFAULT_SOURCE_KEYS]);
    } else {
      setSourceFilter([]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Global Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <span className="text-sm font-medium mb-2 block">Date range</span>
                <RadioGroup
                  value={dateRangeMode}
                  onValueChange={(v) => {
                    const mode = v as "all" | "days";
                    setDateRangeMode(mode);
                    if (mode === "days" && !daysInput.trim()) {
                      setDaysInput("7");
                    }
                  }}
                  className="space-y-3"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all" id="global-date-all" />
                    <Label htmlFor="global-date-all" className="cursor-pointer font-normal">
                      All time
                    </Label>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="days" id="global-date-days" />
                      <Label
                        htmlFor="global-date-days"
                        className="cursor-pointer font-normal whitespace-nowrap"
                      >
                        Last
                      </Label>
                    </div>
                    <div className="flex items-center gap-2 pl-6 sm:pl-0">
                      <Input
                        id="global-date-days-input"
                        type="number"
                        min={1}
                        max={3650}
                        inputMode="numeric"
                        value={daysInput}
                        onChange={(e) => setDaysInput(e.target.value)}
                        disabled={dateRangeMode !== "days"}
                        className="w-20 h-9"
                        aria-label="Number of days for date filter"
                      />
                      <span className="text-sm text-muted-foreground">days</span>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Language</label>
                <RadioGroup value={languageFilter} onValueChange={setLanguageFilter}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all" id="lang-all" />
                    <Label htmlFor="lang-all" className="cursor-pointer font-normal">
                      All Languages
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="en" id="lang-en" />
                    <Label htmlFor="lang-en" className="cursor-pointer font-normal">
                      English
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Checkbox
                  id="global-sources-master"
                  checked={sourcesMasterChecked}
                  onCheckedChange={handleSourcesMasterToggle}
                />
                <Label
                  htmlFor="global-sources-master"
                  className="cursor-pointer text-sm font-medium"
                >
                  Sources
                </Label>
              </div>
              <div className="flex flex-col gap-4 md:flex-row md:items-stretch md:gap-4">
                {SOURCE_SECTIONS.map((section) => {
                  const allInSection = section.keys.every((k) => sourceFilter.includes(k));
                  const someInSection = section.keys.some((k) => sourceFilter.includes(k));
                  const sectionChecked = allInSection
                    ? true
                    : someInSection
                      ? ("indeterminate" as const)
                      : false;

                  return (
                    <div
                      key={section.id}
                      className="min-w-0 flex-1 rounded-md border border-border/70 bg-muted/15 p-3 shadow-sm"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <Checkbox
                          id={`global-section-${section.id}`}
                          checked={sectionChecked}
                          onCheckedChange={() => handleSectionToggle(section.keys)}
                        />
                        <Label
                          htmlFor={`global-section-${section.id}`}
                          className="cursor-pointer text-sm font-medium"
                        >
                          {section.title}
                        </Label>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 pl-6">
                        {section.sources.map((source) => (
                          <div key={source.key} className="flex items-center space-x-2">
                            <Checkbox
                              id={`global-${source.key}`}
                              checked={sourceFilter.includes(source.key)}
                              onCheckedChange={() => handleSourceToggle(source.key)}
                            />
                            <label
                              htmlFor={`global-${source.key}`}
                              className="cursor-pointer text-sm font-normal"
                            >
                              {source.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs — optional deep link: ?tab=network|news|chatter|themes|chat */}
      <Tabs value={analysisTab} onValueChange={setAnalysisTab} className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="results">All Posts</TabsTrigger>
          <TabsTrigger value="network">Influencers</TabsTrigger>
          <TabsTrigger value="news">News</TabsTrigger>
          <TabsTrigger value="chatter">Chatter</TabsTrigger>
          <TabsTrigger value="themes">Themes</TabsTrigger>
          <TabsTrigger value="chat">Ask AI</TabsTrigger>
        </TabsList>
        <TabsContent value="results" className="mt-6">
          <ProjectResults
            projectId={projectId}
            globalDateRange={dateRange}
            globalSourceFilter={sourceFilter}
            languageFilter={languageFilter}
          />
        </TabsContent>
        <TabsContent value="network" className="mt-6">
          <NetworkAnalysis
            projectId={projectId}
            dateRange={dateRange}
            sourceFilter={sourceFilter}
            languageFilter={languageFilter}
          />
        </TabsContent>
        <TabsContent value="chatter" className="mt-6">
          <ChatterAnalysis
            projectId={projectId}
            dateRange={dateRange}
            sourceFilter={sourceFilter}
            languageFilter={languageFilter}
          />
        </TabsContent>
        <TabsContent value="news" className="mt-6">
          <NewsAnalysis
            projectId={projectId}
            dateRange={dateRange}
            sourceFilter={sourceFilter}
            languageFilter={languageFilter}
          />
        </TabsContent>
        <TabsContent value="themes" className="mt-6">
          <ThemesAnalysis
            projectId={projectId}
            dateRange={dateRange}
            sourceFilter={sourceFilter}
            languageFilter={languageFilter}
          />
        </TabsContent>
        <TabsContent value="chat" className="mt-6">
          <ChatAnalysis
            projectId={projectId}
            dateRange={dateRange}
            sourceFilter={sourceFilter}
            languageFilter={languageFilter}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
