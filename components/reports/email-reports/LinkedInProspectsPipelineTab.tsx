"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmailReportRangeUnit } from "@/app/actions/email-report-settings";

type Props = {
  projectId: string;
  rangeAmount: string;
  rangeUnit: EmailReportRangeUnit;
  linkedinMinRelevancePercent: string;
  onLinkedinMinRelevanceChange: (value: string) => void;
  exportHref: string | null;
};

export function LinkedInProspectsPipelineTab({
  projectId,
  linkedinMinRelevancePercent,
  onLinkedinMinRelevanceChange,
  exportHref,
}: Props) {
  if (!projectId) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a project above to export LinkedIn prospects.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>LinkedIn prospects (pipeline CSV)</CardTitle>
        <CardDescription>
          LinkedIn theme rows in the shared reporting window that meet the relevance threshold below.
          Builds private outreach email subject and body per pipeline spec. Requires &quot;My
          product&quot; on the selected project. Saved when you click Save configuration on the
          Email report tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div className="space-y-2">
          <Label htmlFor="linkedin-min-relevance">Minimum relevance % (0–100)</Label>
          <p className="text-xs text-muted-foreground">
            Default 80. Uses the same lookback window as the project bar above.
          </p>
          <Input
            id="linkedin-min-relevance"
            type="number"
            min={0}
            max={100}
            className="w-28"
            value={linkedinMinRelevancePercent}
            onChange={(e) => onLinkedinMinRelevanceChange(e.target.value)}
          />
        </div>
        <div>
          {exportHref ? (
            <Button asChild variant="outline" className="gap-2">
              <a href={exportHref} className="inline-flex items-center">
                <Download className="h-4 w-4" />
                Download LinkedIn prospects CSV
              </a>
            </Button>
          ) : (
            <Button type="button" variant="outline" className="gap-2" disabled>
              <Download className="h-4 w-4" />
              Download LinkedIn prospects CSV
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
