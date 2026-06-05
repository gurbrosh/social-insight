import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { ScraperFormData } from "./types";

interface InputTypeConfigurationCardProps {
  formData: ScraperFormData;
  onUpdate: (field: string, value: any) => void;
}

export function InputTypeConfigurationCard({
  formData,
  onUpdate,
}: InputTypeConfigurationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Input Type Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-base font-medium">
            How does this scraper handle input values?
          </Label>
          <p className="text-sm text-muted-foreground mb-4">
            Choose how the scraper processes keywords/URLs from your projects
          </p>

          <RadioGroup
            value={formData.input_type}
            onValueChange={(value) => onUpdate("input_type", value)}
            className="space-y-3"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="array" id="array" />
              <Label htmlFor="array" className="flex-1">
                <div className="font-medium">Array Input</div>
                <div className="text-sm text-muted-foreground">
                  Scraper can process all keywords/URLs at once as an array
                </div>
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="single" id="single" />
              <Label htmlFor="single" className="flex-1">
                <div className="font-medium">Single Input</div>
                <div className="text-sm text-muted-foreground">
                  Scraper processes one keyword/URL at a time
                </div>
              </Label>
            </div>
          </RadioGroup>
        </div>

        {formData.input_type === "single" && (
          <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="run_iteratively"
                checked={formData.run_iteratively}
                onCheckedChange={(checked) => onUpdate("run_iteratively", checked)}
              />
              <Label htmlFor="run_iteratively" className="flex-1">
                <div className="font-medium">Run iteratively for all values</div>
                <div className="text-sm text-muted-foreground">
                  {formData.run_iteratively
                    ? "Scraper will run multiple times, once for each keyword/URL"
                    : "Scraper will only run once with the first keyword/URL"}
                </div>
              </Label>
            </div>
          </div>
        )}

        {/* Simple Input Type Explanation */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Quick Guide:</strong>
            <br />• <strong>Array Input:</strong> One job with all values. Use{" "}
            <code>{'"{{keywords}}"'}</code> or <code>{'"{{urls}}"'}</code>
            <br />• <strong>Single Input:</strong> One job per value. Use{" "}
            <code>{'"{{keyword}}"'}</code> or <code>{'"{{url}}"'}</code>
          </AlertDescription>
        </Alert>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Placeholders (always use quotes):</strong>
            <br />• <code>{'"{{keywords}}"'}</code> or <code>{'"{{keyword}}"'}</code> for keywords
            <br />• <code>{'"{{urls}}"'}</code> or <code>{'"{{url}}"'}</code> for URLs
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
