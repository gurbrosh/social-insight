"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RotateCcw, Settings } from "lucide-react";

interface ConfigValue {
  value: any;
  dataType: string;
  minValue?: number;
  maxValue?: number;
  options?: string[];
  section?: string;
}

interface ConfigSection {
  [key: string]: ConfigValue;
}

interface AppConfiguration {
  scraping: ConfigSection;
  api: ConfigSection;
  performance: ConfigSection;
  ui: ConfigSection;
  platform: ConfigSection;
}

interface ConfigItem {
  category: string;
  key: string;
  value: any;
  dataType: string;
  displayName?: string;
  description?: string;
  section?: string;
  order?: number;
  minValue?: number;
  maxValue?: number;
  options?: string[];
}

export default function ConfigManager() {
  const [config, setConfig] = useState<AppConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const { toast } = useToast();

  // Fetch configuration on component mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/config");
      const data = await response.json();

      if (data.success) {
        setConfig(data.config);
      } else {
        throw new Error(data.error || "Failed to fetch configuration");
      }
    } catch (error) {
      console.error("Error fetching configuration:", error);
      toast({
        title: "Error",
        description: "Failed to fetch configuration",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const initializeDefaults = async () => {
    try {
      setInitializing(true);
      const response = await fetch("/api/admin/config/initialize", {
        method: "POST",
      });
      const data = await response.json();

      if (data.success) {
        toast({
          title: "Success",
          description: "Default configuration values initialized",
        });
        await fetchConfig(); // Refresh the configuration
      } else {
        throw new Error(data.error || "Failed to initialize configuration");
      }
    } catch (error) {
      console.error("Error initializing configuration:", error);
      toast({
        title: "Error",
        description: "Failed to initialize configuration",
        variant: "destructive",
      });
    } finally {
      setInitializing(false);
    }
  };

  const updateConfig = async (category: string, key: string, value: any, dataType: string) => {
    try {
      setSaving(true);
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          key,
          value,
          dataType,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setConfig((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            [category]: {
              ...prev[category as keyof AppConfiguration],
              [key]: {
                ...prev[category as keyof AppConfiguration][key],
                value,
              },
            },
          };
        });

        toast({
          title: "Success",
          description: "Configuration updated successfully",
        });
      } else {
        throw new Error(data.error || "Failed to update configuration");
      }
    } catch (error) {
      console.error("Error updating configuration:", error);
      toast({
        title: "Error",
        description: "Failed to update configuration",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderConfigInput = (
    category: string,
    key: string,
    configValue: ConfigValue,
    displayName?: string,
    description?: string
  ) => {
    const { value, dataType, minValue, maxValue } = configValue;

    const handleValueChange = (newValue: any) => {
      updateConfig(category, key, newValue, dataType);
    };

    switch (dataType) {
      case "number":
        return (
          <div className="space-y-2">
            <Label htmlFor={`${category}-${key}`}>
              {displayName || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </Label>
            <Input
              id={`${category}-${key}`}
              type="number"
              defaultValue={value}
              min={minValue}
              max={maxValue}
              onBlur={(e) => {
                const newValue = parseFloat(e.target.value) || 0;
                if (newValue !== value) {
                  handleValueChange(newValue);
                }
              }}
              disabled={saving}
            />
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
            {minValue !== undefined && maxValue !== undefined && (
              <p className="text-xs text-muted-foreground">
                Range: {minValue} - {maxValue}
              </p>
            )}
          </div>
        );

      case "boolean":
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Switch
                id={`${category}-${key}`}
                checked={value}
                onCheckedChange={handleValueChange}
                disabled={saving}
              />
              <Label htmlFor={`${category}-${key}`}>
                {displayName || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
              </Label>
            </div>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        );

      case "string":
        return (
          <div className="space-y-2">
            <Label htmlFor={`${category}-${key}`}>
              {displayName || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </Label>
            <Input
              id={`${category}-${key}`}
              type="text"
              defaultValue={value}
              onBlur={(e) => {
                if (e.target.value !== value) {
                  handleValueChange(e.target.value);
                }
              }}
              disabled={saving}
            />
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        );

      case "array":
        return (
          <div className="space-y-2">
            <Label htmlFor={`${category}-${key}`}>
              {displayName || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </Label>
            <div className="space-y-1">
              {Array.isArray(value) &&
                value.map((item, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <Input
                      defaultValue={item}
                      onBlur={(e) => {
                        if (e.target.value !== item) {
                          const newArray = [...value];
                          newArray[index] = e.target.value;
                          handleValueChange(newArray);
                        }
                      }}
                      disabled={saving}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newArray = value.filter((_, i) => i !== index);
                        handleValueChange(newArray);
                      }}
                      disabled={saving}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newArray = [...(value || []), ""];
                  handleValueChange(newArray);
                }}
                disabled={saving}
              >
                Add Item
              </Button>
            </div>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        );

      case "object":
        return (
          <div className="space-y-2">
            <Label htmlFor={`${category}-${key}`}>
              {displayName || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </Label>
            <textarea
              id={`${category}-${key}`}
              className="w-full p-2 border rounded-md font-mono text-sm"
              rows={4}
              defaultValue={JSON.stringify(value, null, 2)}
              onBlur={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (JSON.stringify(parsed) !== JSON.stringify(value)) {
                    handleValueChange(parsed);
                  }
                } catch {
                  // Invalid JSON, show error toast
                  toast({
                    title: "Invalid JSON",
                    description: "Please enter valid JSON format",
                    variant: "destructive",
                  });
                }
              }}
              disabled={saving}
            />
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            <Label htmlFor={`${category}-${key}`}>
              {displayName || key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </Label>
            <Input
              id={`${category}-${key}`}
              type="text"
              defaultValue={String(value)}
              onBlur={(e) => {
                if (e.target.value !== String(value)) {
                  handleValueChange(e.target.value);
                }
              }}
              disabled={saving}
            />
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        );
    }
  };

  const renderConfigSection = (
    category: string,
    sectionName: string,
    sectionConfig: ConfigSection
  ) => {
    const sections = new Map<string, ConfigItem[]>();

    // Group items by section
    Object.entries(sectionConfig).forEach(([key, configValue]) => {
      const section = configValue.section || "General";
      if (!sections.has(section)) {
        sections.set(section, []);
      }
      sections.get(section)!.push({
        category,
        key,
        ...configValue,
      });
    });

    return (
      <div className="space-y-6">
        {Array.from(sections.entries()).map(([sectionName, items]) => (
          <Card key={sectionName}>
            <CardHeader>
              <CardTitle className="text-lg">{sectionName}</CardTitle>
              <CardDescription>
                Configuration settings for {sectionName.toLowerCase()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {items
                .sort((a, b) => (a.order || 0) - (b.order || 0))
                .map((item) => (
                  <div key={item.key} className="space-y-2">
                    {renderConfigInput(
                      item.category,
                      item.key,
                      {
                        value: item.value,
                        dataType: item.dataType,
                        minValue: item.minValue,
                        maxValue: item.maxValue,
                        options: item.options,
                      },
                      item.displayName,
                      item.description
                    )}
                    <Separator />
                  </div>
                ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading configuration...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="text-center p-8">
        <p className="text-muted-foreground mb-4">No configuration found</p>
        <Button onClick={initializeDefaults} disabled={initializing}>
          {initializing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RotateCcw className="h-4 w-4 mr-2" />
          )}
          Initialize Default Configuration
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Application Configuration</h2>
          <p className="text-muted-foreground">Manage application settings and parameters</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={initializeDefaults} disabled={initializing}>
            {initializing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Reset to Defaults
          </Button>
          <Button onClick={fetchConfig} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Settings className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="scraping" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="scraping">Scraping</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="ui">UI</TabsTrigger>
          <TabsTrigger value="platform">Platform</TabsTrigger>
        </TabsList>

        <TabsContent value="scraping">
          {renderConfigSection("scraping", "Scraping Configuration", config.scraping)}
        </TabsContent>

        <TabsContent value="api">
          {renderConfigSection("api", "API Configuration", config.api)}
        </TabsContent>

        <TabsContent value="performance">
          {renderConfigSection("performance", "Performance Configuration", config.performance)}
        </TabsContent>

        <TabsContent value="ui">
          {renderConfigSection("ui", "UI Configuration", config.ui)}
        </TabsContent>

        <TabsContent value="platform">
          {renderConfigSection("platform", "Platform Configuration", config.platform)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
