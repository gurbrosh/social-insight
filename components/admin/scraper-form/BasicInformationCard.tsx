import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScraperFormData } from "./types";

interface BasicInformationCardProps {
  formData: ScraperFormData;
  errors: Record<string, string>;
  onUpdate: (field: string, value: any) => void;
}

export function BasicInformationCard({ formData, errors, onUpdate }: BasicInformationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="name">Scraper Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => onUpdate("name", e.target.value)}
            placeholder="e.g., Twitter Posts Scraper"
            className={errors.name ? "border-red-500" : ""}
          />
          {errors.name && <p className="text-sm text-red-600 mt-1">{errors.name}</p>}
        </div>

        <div>
          <Label htmlFor="descriptive_name">Descriptive (External) Name</Label>
          <Input
            id="descriptive_name"
            value={formData.descriptive_name}
            onChange={(e) => onUpdate("descriptive_name", e.target.value)}
            placeholder="Name shown to external stakeholders"
            className={errors.descriptive_name ? "border-red-500" : ""}
          />
          {errors.descriptive_name && (
            <p className="text-sm text-red-600 mt-1">{errors.descriptive_name}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Optional friendly name that appears in external communications and reports
          </p>
        </div>

        <div>
          <Label htmlFor="actor_id">Apify Actor ID *</Label>
          <Input
            id="actor_id"
            value={formData.actor_id}
            onChange={(e) => onUpdate("actor_id", e.target.value)}
            placeholder="e.g., apify/twitter-scraper"
            className={errors.actor_id ? "border-red-500" : ""}
          />
          {errors.actor_id && <p className="text-sm text-red-600 mt-1">{errors.actor_id}</p>}
          <p className="text-sm text-muted-foreground mt-1">
            The Apify actor ID (e.g., apify/twitter-scraper)
          </p>
        </div>

        <div>
          <Label htmlFor="readme_url">Documentation URL</Label>
          <Input
            id="readme_url"
            value={formData.readme_url}
            onChange={(e) => onUpdate("readme_url", e.target.value)}
            placeholder="https://github.com/user/repo#readme"
            className={errors.readme_url ? "border-red-500" : ""}
          />
          {errors.readme_url && <p className="text-sm text-red-600 mt-1">{errors.readme_url}</p>}
          <p className="text-sm text-muted-foreground mt-1">
            Optional URL to scraper documentation or README for easy reference
          </p>
        </div>

        <div>
          <Label htmlFor="platform">Platform *</Label>
          <Select value={formData.platform} onValueChange={(value) => onUpdate("platform", value)}>
            <SelectTrigger className={errors.platform ? "border-red-500" : ""}>
              <SelectValue placeholder="Select the platform this scraper targets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="facebook">Facebook</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="x">X (Twitter)</SelectItem>
              <SelectItem value="reddit">Reddit</SelectItem>
              <SelectItem value="discord">Discord</SelectItem>
              <SelectItem value="website">Website</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
            </SelectContent>
          </Select>
          {errors.platform && <p className="text-sm text-red-600 mt-1">{errors.platform}</p>}
          <p className="text-sm text-muted-foreground mt-1">
            The social media platform or website this scraper targets
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => onUpdate("is_active", checked)}
            />
            <Label htmlFor="is_active" className="flex-1">
              <div className="font-medium">Active</div>
              <div className="text-sm text-muted-foreground">
                Enable this scraper for use in projects
              </div>
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="save_to_db"
              checked={formData.save_to_db}
              onCheckedChange={(checked) => onUpdate("save_to_db", checked)}
            />
            <Label htmlFor="save_to_db" className="flex-1">
              <div className="font-medium">Save to Database</div>
              <div className="text-sm text-muted-foreground">
                If unchecked, results will be sent to downstream systems only
              </div>
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            If unchecked, results will be sent to downstream systems only
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
