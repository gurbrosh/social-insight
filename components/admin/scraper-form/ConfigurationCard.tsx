import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { ScraperFormData } from "./types";

interface ConfigurationCardProps {
  formData: ScraperFormData;
  errors: Record<string, string>;
  onUpdate: (field: string, value: any) => void;
}

export function ConfigurationCard({ formData, errors, onUpdate }: ConfigurationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* URL Input Configuration */}
        <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
          <div>
            <Label className="text-base font-medium">URL Input Configuration</Label>
            <p className="text-sm text-muted-foreground">
              Configure this scraper to use URLs from downstream posts as input
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="url_input_field_name">Field Name in Config</Label>
              <Input
                id="url_input_field_name"
                value={formData.url_input_field_name}
                onChange={(e) => onUpdate("url_input_field_name", e.target.value)}
                placeholder="e.g., urls, startUrls, inputUrls"
                className={errors.url_input_field_name ? "border-red-500" : ""}
              />
              {errors.url_input_field_name && (
                <p className="text-sm text-red-600 mt-1">{errors.url_input_field_name}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                The field name in your JSON config where URLs should be injected
              </p>
            </div>

            <div>
              <Label htmlFor="url_input_source_scraper">Source Scraper Name</Label>
              <Input
                id="url_input_source_scraper"
                value={formData.url_input_source_scraper}
                onChange={(e) => onUpdate("url_input_source_scraper", e.target.value)}
                placeholder="e.g., LinkedIn Posts Search Scraper"
                className={errors.url_input_source_scraper ? "border-red-500" : ""}
              />
              {errors.url_input_source_scraper && (
                <p className="text-sm text-red-600 mt-1">{errors.url_input_source_scraper}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1">
                Name of the scraper whose downstream posts will provide URLs
              </p>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>URL Input Feature:</strong> When both fields are configured, this scraper
              will:
              <br />• Fetch URLs from DownstreamPost table where origScraper matches the source
              scraper name
              <br />• Inject those URLs into the specified field in your JSON configuration
              <br />• Use the URLs as input for the scraper run
            </AlertDescription>
          </Alert>
        </div>

        <div>
          <Label htmlFor="config_json">JSON Configuration *</Label>
          <Textarea
            id="config_json"
            value={formData.config_json}
            onChange={(e) => onUpdate("config_json", e.target.value)}
            placeholder="Enter JSON configuration..."
            rows={12}
            className={`font-mono text-sm ${errors.config_json ? "border-red-500" : ""}`}
          />
          {errors.config_json && <p className="text-sm text-red-600 mt-1">{errors.config_json}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
