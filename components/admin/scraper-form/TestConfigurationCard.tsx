import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { KeywordSelector } from "../KeywordSelector";
import { PlatformPreview } from "./PlatformPreview";
import { ScraperFormData } from "./types";

interface TestConfigurationCardProps {
  formData: ScraperFormData;
  selectedProjectId: string;
  onProjectChange: (projectId: string) => void;
  testKeywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  saveTestResults: boolean;
  onSaveTestResultsChange: (save: boolean) => void;
  onTestScraper: () => void;
  isTesting: boolean;
  testResult: any;
}

export function TestConfigurationCard({
  formData,
  selectedProjectId,
  onProjectChange,
  testKeywords,
  onKeywordsChange,
  saveTestResults,
  onSaveTestResultsChange,
  onTestScraper,
  isTesting,
  testResult,
}: TestConfigurationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <KeywordSelector
          selectedProjectId={selectedProjectId}
          onProjectChange={onProjectChange}
          selectedKeywords={testKeywords}
          onKeywordsChange={onKeywordsChange}
        />

        {/* Platform Combined Input Preview */}
        {(formData.platform === "reddit" ||
          formData.platform === "x" ||
          formData.platform === "linkedin") &&
          selectedProjectId && (
            <PlatformPreview
              projectId={selectedProjectId}
              keywords={testKeywords}
              platform={formData.platform as "reddit" | "x" | "linkedin"}
            />
          )}

        {/* Debug info for X scrapers */}
        {formData.platform === "x" && (
          <div className="p-3 border rounded-lg bg-blue-50">
            <div className="text-sm font-medium text-blue-800 mb-2">🐦 X Scraper Status</div>
            <div className="text-sm text-blue-700">
              <div>Platform: {formData.platform}</div>
              <div>Project Selected: {selectedProjectId ? "Yes" : "No"}</div>
              <div>Keywords: {testKeywords.length}</div>
              <div>
                Test Button Enabled:{" "}
                {(() => {
                  const hasKeywords = testKeywords.length > 0;
                  const hasUrlInput =
                    formData.url_input_field_name && formData.url_input_source_scraper;
                  const isXWithProject = selectedProjectId;
                  return hasKeywords || hasUrlInput || isXWithProject ? "Yes" : "No";
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Debug info for LinkedIn scrapers */}
        {formData.platform === "linkedin" && (
          <div className="p-3 border rounded-lg bg-blue-50">
            <div className="text-sm font-medium text-blue-800 mb-2">💼 LinkedIn Scraper Status</div>
            <div className="text-sm text-blue-700">
              <div>Platform: {formData.platform}</div>
              <div>Project Selected: {selectedProjectId ? "Yes" : "No"}</div>
              <div>Keywords: {testKeywords.length}</div>
              <div>
                Test Button Enabled:{" "}
                {(() => {
                  const hasKeywords = testKeywords.length > 0;
                  const hasUrlInput =
                    formData.url_input_field_name && formData.url_input_source_scraper;
                  const isLinkedInWithProject = selectedProjectId;
                  return hasKeywords || hasUrlInput || isLinkedInWithProject ? "Yes" : "No";
                })()}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <Checkbox
            id="save_test_results"
            checked={saveTestResults}
            onCheckedChange={(checked) => onSaveTestResultsChange(checked as boolean)}
            disabled={
              formData.platform === "discord" ||
              (testKeywords.length === 0 &&
                !(formData.url_input_field_name && formData.url_input_source_scraper) &&
                !(formData.platform === "x" && selectedProjectId) &&
                !(formData.platform === "linkedin" && selectedProjectId))
            }
          />
          <Label htmlFor="save_test_results" className="flex-1">
            <div className="font-medium">Save test results to database</div>
            <div className="text-sm text-muted-foreground">
              {formData.platform === "discord"
                ? "Discord scrapers always save test results to the database"
                : saveTestResults
                  ? `Test results will be saved to ${formData.save_to_db ? "Post" : "DownstreamPost"} table with isTest=true`
                  : "Test results will not be saved to the database"}
            </div>
          </Label>
        </div>

        <Button
          type="button"
          onClick={onTestScraper}
          disabled={
            isTesting ||
            (testKeywords.length === 0 &&
              !(formData.url_input_field_name && formData.url_input_source_scraper) &&
              formData.platform !== "discord" &&
              !(formData.platform === "x" && selectedProjectId) &&
              !(formData.platform === "linkedin" && selectedProjectId))
          }
          className="bg-black hover:bg-gray-800 text-white"
        >
          {isTesting ? "Testing..." : "Test Scraper"}
        </Button>

        {testResult && (
          <div className="mt-4 p-4 border rounded-lg">
            <h4 className="font-medium mb-2">Test Result:</h4>
            <pre className="text-sm bg-muted p-2 rounded overflow-auto">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
