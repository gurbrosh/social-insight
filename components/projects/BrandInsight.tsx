"use client";

import { useState, useEffect, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
  LineChart,
  Line,
} from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface BrandInsightProps {
  projectId: string;
}

interface BrandMention {
  brandName: string;
  totalMentions: number;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
}

interface BrandInsightData {
  brands?: BrandMention[];
  timeline?: Array<{
    date: string;
    [key: string]: string | number;
  }>;
  allBrands: string[];
}

const sentimentColors = {
  positive: "#22c55e", // green
  negative: "#ef4444", // red
  neutral: "#6b7280", // gray
  mixed: "#eab308", // yellow
};

// Color palette for brands (distinct colors that work well together)
const brandColorPalette = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#a855f7", // purple
];

// Function to get a consistent color for a brand based on its name
// When there are only a few brands, ensures maximum color difference
const getBrandColor = (brandName: string, index: number, totalBrands: number): string => {
  // For 2 brands, use colors that are maximally different (e.g., opposite sides of palette)
  if (totalBrands === 2) {
    // Use index to pick colors from opposite ends of the palette
    const colors = [brandColorPalette[0], brandColorPalette[6]]; // Blue and Cyan - very different
    return colors[index % colors.length];
  }

  // For 3 brands, space them out evenly
  if (totalBrands === 3) {
    const spacing = Math.floor(brandColorPalette.length / 3);
    return brandColorPalette[(index * spacing) % brandColorPalette.length];
  }

  // For more brands, still try to space them out but fall back to hash for consistency
  if (totalBrands <= brandColorPalette.length) {
    const spacing = Math.floor(brandColorPalette.length / totalBrands);
    return brandColorPalette[(index * spacing) % brandColorPalette.length];
  }

  // Fallback: Use a hash of the brand name for consistency with many brands
  let hash = 0;
  for (let i = 0; i < brandName.length; i++) {
    hash = brandName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % brandColorPalette.length;
  return brandColorPalette[colorIndex];
};

// Line style configurations for different brands
const lineStyles = [
  { strokeDasharray: undefined, strokeWidth: 3, dot: false }, // solid, bold
  { strokeDasharray: "10 5", strokeWidth: 2.5, dot: false }, // long dashes
  { strokeDasharray: "5 5", strokeWidth: 2.5, dot: false }, // medium dashes
  { strokeDasharray: "3 3", strokeWidth: 2, dot: false }, // short dashes
  { strokeDasharray: "15 5 5 5", strokeWidth: 2.5, dot: false }, // dash-dot
  { strokeDasharray: "2 2", strokeWidth: 2, dot: false }, // dotted
  { strokeDasharray: undefined, strokeWidth: 2.5, dot: true }, // solid with dots
  { strokeDasharray: "8 4", strokeWidth: 2.5, dot: true }, // dashed with dots
  { strokeDasharray: undefined, strokeWidth: 4, dot: false }, // extra bold solid
  { strokeDasharray: "20 5 5 5 5 5", strokeWidth: 2.5, dot: false }, // long dash-dot-dot
  { strokeDasharray: "4 2 2 2", strokeWidth: 2, dot: false }, // dot-dash pattern
  { strokeDasharray: "6 3 2 3", strokeWidth: 2.5, dot: false }, // custom pattern
];

// Function to get line style for a brand
const getLineStyle = (brandName: string, _index: number) => {
  let hash = 0;
  for (let i = 0; i < brandName.length; i++) {
    hash = brandName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const styleIndex = Math.abs(hash) % lineStyles.length;
  return lineStyles[styleIndex];
};

export function BrandInsight({ projectId }: BrandInsightProps) {
  const [data, setData] = useState<BrandInsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState("all");
  const [view, setView] = useState<"summary" | "timeline">("summary");
  const [showMentions, setShowMentions] = useState(true);
  const [showSentiment, setShowSentiment] = useState(true);

  useEffect(() => {
    fetchBrandInsights();
  }, [projectId, selectedBrands, dateRange, view]);

  const fetchBrandInsights = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        dateRange,
        view,
        ...(selectedBrands.length > 0 && { brands: selectedBrands.join(",") }),
      });

      const response = await fetch(`/api/projects/${projectId}/brand-insights?${params}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch brand insights");
      }

      const result = await response.json();

      console.log("[BrandInsight Component] API Response:", {
        brands: result.brands,
        brandsLength: result.brands?.length,
        timeline: result.timeline,
        timelineLength: result.timeline?.length,
        allBrands: result.allBrands,
        allBrandsLength: result.allBrands?.length,
        error: result.error,
      });

      // Ensure allBrands is always set, even if empty or if there's an error
      if (!result.allBrands) {
        result.allBrands = [];
      }

      // Ensure brands is always an array (for summary view)
      if (!result.brands && view === "summary") {
        result.brands = [];
      }

      // Ensure timeline is always an array (for timeline view)
      if (!result.timeline && view === "timeline") {
        result.timeline = [];
      }

      // If there's an error but we still have brands, show a warning but continue
      if (result.error && result.allBrands && result.allBrands.length > 0) {
        toast({
          title: "Warning",
          description: result.error,
          variant: "default",
        });
      }

      setData(result);

      // Initialize selected brands if not set and we have brands
      if (selectedBrands.length === 0 && result.allBrands && result.allBrands.length > 0) {
        setSelectedBrands(result.allBrands);
      }
    } catch (error) {
      console.error("Error fetching brand insights:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to load brand insights. Please try again.",
        variant: "destructive",
      });
      // Set data to null to show the error state
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleBrandToggle = (brandName: string, checked: boolean) => {
    if (checked) {
      setSelectedBrands([...selectedBrands, brandName]);
    } else {
      setSelectedBrands(selectedBrands.filter((b) => b !== brandName));
    }
  };

  // Prepare data for chart
  const chartData =
    data?.brands
      ?.filter((brand) => brand.totalMentions > 0)
      ?.map((brand) => ({
        brand: brand.brandName,
        Positive: brand.positive,
        Negative: brand.negative,
        Neutral: brand.neutral,
        Mixed: brand.mixed,
        Total: brand.totalMentions,
      }))
      ?.sort((a, b) => b.Total - a.Total) || [];

  console.log("[BrandInsight Component] Chart Data:", {
    dataExists: !!data,
    brandsArray: data?.brands,
    brandsLength: data?.brands?.length,
    chartDataLength: chartData.length,
    chartData,
  });

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-semibold mb-2">{payload[0].payload.brand}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => {
              if (entry.dataKey === "Total") return null;
              return (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded"
                    style={{
                      backgroundColor:
                        sentimentColors[
                          entry.dataKey.toLowerCase() as keyof typeof sentimentColors
                        ],
                    }}
                  />
                  <span className="text-muted-foreground">{entry.name}:</span>
                  <span className="font-medium">{entry.value}</span>
                </div>
              );
            })}
            <div className="pt-1 mt-1 border-t">
              <span className="text-sm font-semibold">Total: {payload[0].payload.Total}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomLegend = () => {
    const legendItems = [
      { name: "Positive", color: sentimentColors.positive },
      { name: "Negative", color: sentimentColors.negative },
      { name: "Mixed", color: sentimentColors.mixed },
      { name: "Neutral", color: sentimentColors.neutral },
    ];

    return (
      <div className="flex flex-wrap justify-center gap-4 mt-4">
        {legendItems.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }} />
            <span className="text-sm text-muted-foreground">{item.name}</span>
          </div>
        ))}
      </div>
    );
  };

  // Custom label function for percentage display in bar segments using LabelList
  const renderPercentageLabel = (dataKey: string) => {
    const PercentageLabel = (props: any) => {
      // LabelList provides: { x, y, width, height, value, payload, index, ... }
      const { x, y, width, height, value, payload, index } = props;

      if (!value || value === 0 || !width || !height || height < 15) {
        return null;
      }

      // Always get Total from chartData using the index to ensure accuracy
      // For stacked bars, we need to get the actual segment value from the payload
      let total = 0;
      let segmentValue = value; // Start with the value prop

      if (index !== undefined && chartData && chartData[index]) {
        const dataEntry = chartData[index];
        total = dataEntry.Total; // This is brand.totalMentions (e.g., 934)

        // Get the actual segment value from the data entry
        // The dataKey matches the property name (Positive, Negative, Neutral, Mixed)
        segmentValue = (dataEntry[dataKey as keyof typeof dataEntry] as number) || value;

        // Debug logging for Lovable Negative case
        if (dataEntry.brand === "Lovable Technology" && dataKey === "Negative") {
          console.log(`[Label Debug]`, {
            dataKey,
            value, // From props
            segmentValue, // From dataEntry
            total,
            dataEntry,
            payload,
            calculated: Math.round((segmentValue / total) * 100),
          });
        }
      } else if (payload && payload.Total) {
        total = payload.Total;
        segmentValue = payload[dataKey] || value;
      } else {
        return null;
      }

      // Calculate percentage: (sentiment count / total brand mentions) * 100
      // Example: 226 Negative / 934 Total = 24%
      const percentage = Math.round((segmentValue / total) * 100);

      // Only show label if percentage > 20% AND segmentValue > 25
      if (percentage > 20 && segmentValue > 25) {
        return (
          <text
            x={x + width / 2}
            y={y + height / 2}
            fill="#fff"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontWeight="600"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {`(${percentage}%)`}
          </text>
        );
      }
      return null;
    };
    PercentageLabel.displayName = `PercentageLabel-${dataKey}`;
    return PercentageLabel;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Brand Insight
          </CardTitle>
          <CardDescription>Analyzing brand mentions and sentiment</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.allBrands || data.allBrands.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Brand Insight
          </CardTitle>
          <CardDescription>Analyzing brand mentions and sentiment</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No brands configured for this project. Add brands in project settings to see insights.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Brand Insight
        </CardTitle>
        <CardDescription>Brand mentions and sentiment analysis across all posts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* View Toggle */}
        <div className="flex justify-center">
          <Tabs value={view} onValueChange={(v) => setView(v as "summary" | "timeline")}>
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          {/* Date Range Selector */}
          <div className="flex-1">
            <Label htmlFor="dateRange" className="mb-2 block">
              Date Range
            </Label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger id="dateRange">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="quarter">This quarter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Brand Selection */}
          <div className="flex-1">
            <Label className="mb-2 block">Brands to Display</Label>
            <div className="flex flex-wrap gap-3 max-h-32 overflow-y-auto p-2 border rounded-md">
              {data.allBrands.map((brand) => (
                <div key={brand} className="flex items-center space-x-2">
                  <Checkbox
                    id={`brand-${brand}`}
                    checked={selectedBrands.includes(brand)}
                    onCheckedChange={(checked) => handleBrandToggle(brand, checked as boolean)}
                  />
                  <Label htmlFor={`brand-${brand}`} className="text-sm font-normal cursor-pointer">
                    {brand}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline View Options */}
          {view === "timeline" && (
            <div className="flex flex-col gap-3">
              <Label className="mb-2 block">Display Options</Label>
              <div className="flex flex-col gap-2 p-2 border rounded-md">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="show-mentions"
                    checked={showMentions}
                    onCheckedChange={(checked) => setShowMentions(checked as boolean)}
                  />
                  <Label htmlFor="show-mentions" className="text-sm font-normal cursor-pointer">
                    Mentions
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="show-sentiment"
                    checked={showSentiment}
                    onCheckedChange={(checked) => setShowSentiment(checked as boolean)}
                  />
                  <Label htmlFor="show-sentiment" className="text-sm font-normal cursor-pointer">
                    Sentiments (Positive/Negative)
                  </Label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chart - Summary View */}
        {view === "summary" && chartData.length > 0 ? (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={chartData}
                margin={{
                  top: 20,
                  right: 30,
                  left: 20,
                  bottom: 60,
                }}
                barCategoryGap={0}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="brand" angle={-45} textAnchor="end" height={100} interval={0} />
                <YAxis
                  label={{
                    value: "Number of Mentions",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle" },
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend content={<CustomLegend />} />
                <Bar
                  dataKey="Positive"
                  stackId="a"
                  fill={sentimentColors.positive}
                  radius={[0, 0, 12, 12]}
                  stroke="#000000"
                  strokeWidth={1}
                  isAnimationActive={false}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-positive-${index}`} fill={sentimentColors.positive} />
                  ))}
                  <LabelList content={renderPercentageLabel("Positive")} position="inside" />
                </Bar>
                <Bar
                  dataKey="Negative"
                  stackId="a"
                  fill={sentimentColors.negative}
                  radius={0}
                  stroke="#000000"
                  strokeWidth={1}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-negative-${index}`} fill={sentimentColors.negative} />
                  ))}
                  <LabelList content={renderPercentageLabel("Negative")} position="inside" />
                </Bar>
                <Bar
                  dataKey="Mixed"
                  stackId="a"
                  fill={sentimentColors.mixed}
                  radius={0}
                  stroke="#000000"
                  strokeWidth={1}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-mixed-${index}`} fill={sentimentColors.mixed} />
                  ))}
                  <LabelList content={renderPercentageLabel("Mixed")} position="inside" />
                </Bar>
                <Bar
                  dataKey="Neutral"
                  stackId="a"
                  fill={sentimentColors.neutral}
                  radius={[12, 12, 0, 0]}
                  stroke="#000000"
                  strokeWidth={1}
                  isAnimationActive={false}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-neutral-${index}`} fill={sentimentColors.neutral} />
                  ))}
                  <LabelList content={renderPercentageLabel("Neutral")} position="inside" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Summary Stats */}
            {data.brands && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: sentimentColors.positive }}>
                    {data.brands.reduce((sum, b) => sum + b.positive, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Positive</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: sentimentColors.negative }}>
                    {data.brands.reduce((sum, b) => sum + b.negative, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Negative</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: sentimentColors.mixed }}>
                    {data.brands.reduce((sum, b) => sum + b.mixed, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Mixed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold" style={{ color: sentimentColors.neutral }}>
                    {data.brands.reduce((sum, b) => sum + b.neutral, 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Neutral</div>
                </div>
              </div>
            )}
          </div>
        ) : view === "summary" ? (
          <div className="text-center py-12 text-muted-foreground">
            {selectedBrands.length === 0
              ? "Select brands to view insights"
              : "No brand mentions found for the selected brands and date range"}
          </div>
        ) : null}

        {/* Timeline View */}
        {view === "timeline" && data?.timeline && data.timeline.length > 0 ? (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={400}>
              <LineChart
                data={data.timeline}
                margin={{
                  top: 20,
                  right: 30,
                  left: 20,
                  bottom: 60,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  interval={0}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  }}
                />
                <YAxis
                  label={{
                    value: "Number of Mentions",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle" },
                  }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length && label) {
                      const date = new Date(label as string);
                      return (
                        <div className="bg-background border rounded-lg p-3 shadow-lg">
                          <p className="font-semibold mb-2">
                            {date.toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </p>
                          <div className="space-y-1">
                            {payload.map((entry: any, index: number) => {
                              const dataKey = entry.dataKey as string;
                              const brandMatch = dataKey.match(
                                /^(.+?)_(mentions|positive|negative)$/
                              );
                              if (!brandMatch) return null;

                              const brandName = brandMatch[1];
                              const metric = brandMatch[2];
                              const brandIndex = selectedBrands.indexOf(brandName);
                              const totalBrands = selectedBrands.length;
                              let color = "#3b82f6";
                              if (metric === "mentions") {
                                color = getBrandColor(brandName, brandIndex, totalBrands);
                              } else if (metric === "positive") {
                                let positiveColorIndex: number;
                                if (totalBrands <= 3) {
                                  const spacing = Math.floor(brandColorPalette.length / 3);
                                  positiveColorIndex =
                                    (brandIndex * spacing + spacing) % brandColorPalette.length;
                                } else {
                                  positiveColorIndex =
                                    (brandIndex + Math.floor(brandColorPalette.length / 4)) %
                                    brandColorPalette.length;
                                }
                                color = brandColorPalette[positiveColorIndex];
                              } else {
                                let negativeColorIndex: number;
                                if (totalBrands <= 3) {
                                  const spacing = Math.floor(brandColorPalette.length / 3);
                                  negativeColorIndex =
                                    (brandIndex * spacing + spacing * 2) % brandColorPalette.length;
                                } else {
                                  negativeColorIndex =
                                    (brandIndex + Math.floor(brandColorPalette.length / 2)) %
                                    brandColorPalette.length;
                                }
                                color = brandColorPalette[negativeColorIndex];
                              }

                              return (
                                <div key={index} className="flex items-center gap-2 text-sm">
                                  <div
                                    className="w-3 h-3 rounded"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-muted-foreground">
                                    {brandName} (
                                    {metric === "mentions"
                                      ? "Mentions"
                                      : metric === "positive"
                                        ? "Positive"
                                        : "Negative"}
                                    ):
                                  </span>
                                  <span className="font-medium">{entry.value}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend content={() => null} />
                {selectedBrands.map((brandName, index) => {
                  const totalBrands = selectedBrands.length;
                  const brandColor = getBrandColor(brandName, index, totalBrands);
                  const lineStyle = getLineStyle(brandName, index);

                  // Get different colors for positive and negative by offsetting in the palette
                  // For few brands, ensure these are also well-separated
                  const mentionsColor = brandColor;
                  let positiveColorIndex: number;
                  let negativeColorIndex: number;

                  if (totalBrands <= 3) {
                    // For few brands, use well-separated colors
                    const spacing = Math.floor(brandColorPalette.length / 3);
                    positiveColorIndex = (index * spacing + spacing) % brandColorPalette.length;
                    negativeColorIndex = (index * spacing + spacing * 2) % brandColorPalette.length;
                  } else {
                    positiveColorIndex =
                      (index + Math.floor(brandColorPalette.length / 4)) % brandColorPalette.length;
                    negativeColorIndex =
                      (index + Math.floor(brandColorPalette.length / 2)) % brandColorPalette.length;
                  }

                  const positiveColor = brandColorPalette[positiveColorIndex];
                  const negativeColor = brandColorPalette[negativeColorIndex];

                  // Use clearly different line styles for different metrics
                  // Mentions: use the base style (solid or brand-specific pattern)
                  // Positive: distinctly different pattern (always dashed)
                  // Negative: another distinctly different pattern (always dotted/dashed)
                  const mentionsStyle = lineStyle;

                  // For positive, use a distinct dashed pattern regardless of base style
                  const positiveStyle = {
                    strokeDasharray: "10 5", // Long dashes
                    strokeWidth: 2.5,
                    dot: false,
                  };

                  // For negative, use a distinct dot-dash pattern
                  const negativeStyle = {
                    strokeDasharray: "5 3 2 3", // Dot-dash pattern
                    strokeWidth: 2.5,
                    dot: false,
                  };

                  return (
                    <Fragment key={brandName}>
                      {showMentions && (
                        <Line
                          type="monotone"
                          dataKey={`${brandName}_mentions`}
                          name={`${brandName} - Mentions`}
                          stroke={mentionsColor}
                          strokeWidth={mentionsStyle.strokeWidth}
                          strokeDasharray={mentionsStyle.strokeDasharray}
                          dot={mentionsStyle.dot ? { fill: mentionsColor, r: 3 } : false}
                          connectNulls
                        />
                      )}
                      {showSentiment && (
                        <>
                          <Line
                            type="monotone"
                            dataKey={`${brandName}_positive`}
                            name={`${brandName} - Positive`}
                            stroke={positiveColor}
                            strokeWidth={positiveStyle.strokeWidth}
                            strokeDasharray={positiveStyle.strokeDasharray}
                            dot={positiveStyle.dot ? { fill: positiveColor, r: 3 } : false}
                            connectNulls
                          />
                          <Line
                            type="monotone"
                            dataKey={`${brandName}_negative`}
                            name={`${brandName} - Negative`}
                            stroke={negativeColor}
                            strokeWidth={negativeStyle.strokeWidth}
                            strokeDasharray={negativeStyle.strokeDasharray}
                            dot={negativeStyle.dot ? { fill: negativeColor, r: 3 } : false}
                            connectNulls
                          />
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </LineChart>
            </ResponsiveContainer>

            {/* Custom Legend - Stacked by Brand */}
            <div className="border-t pt-4 mt-4">
              <div className="flex flex-wrap gap-6 justify-center">
                {selectedBrands.map((brandName, index) => {
                  const totalBrands = selectedBrands.length;
                  const brandColor = getBrandColor(brandName, index, totalBrands);
                  const lineStyle = getLineStyle(brandName, index);

                  let positiveColorIndex: number;
                  let negativeColorIndex: number;

                  if (totalBrands <= 3) {
                    const spacing = Math.floor(brandColorPalette.length / 3);
                    positiveColorIndex = (index * spacing + spacing) % brandColorPalette.length;
                    negativeColorIndex = (index * spacing + spacing * 2) % brandColorPalette.length;
                  } else {
                    positiveColorIndex =
                      (index + Math.floor(brandColorPalette.length / 4)) % brandColorPalette.length;
                    negativeColorIndex =
                      (index + Math.floor(brandColorPalette.length / 2)) % brandColorPalette.length;
                  }

                  const positiveColor = brandColorPalette[positiveColorIndex];
                  const negativeColor = brandColorPalette[negativeColorIndex];

                  // Create line indicators that match the chart
                  const renderLineIndicator = (
                    color: string,
                    style: { strokeDasharray?: string; strokeWidth: number; dot?: boolean }
                  ) => {
                    const isSolid = !style.strokeDasharray;

                    return (
                      <div className="flex items-center">
                        <svg width="24" height="4" className="overflow-visible">
                          <line
                            x1="0"
                            y1="2"
                            x2="24"
                            y2="2"
                            stroke={color}
                            strokeWidth={style.strokeWidth}
                            strokeDasharray={isSolid ? undefined : style.strokeDasharray}
                            vectorEffect="non-scaling-stroke"
                          />
                          {style.dot && (
                            <>
                              <circle cx="4" cy="2" r="1.5" fill={color} />
                              <circle cx="12" cy="2" r="1.5" fill={color} />
                              <circle cx="20" cy="2" r="1.5" fill={color} />
                            </>
                          )}
                        </svg>
                      </div>
                    );
                  };

                  return (
                    <div key={brandName} className="flex flex-col gap-2">
                      <div className="font-semibold text-sm">{brandName}</div>
                      <div className="flex flex-wrap gap-3">
                        {showMentions && (
                          <div className="flex items-center gap-2">
                            {renderLineIndicator(brandColor, {
                              strokeDasharray: lineStyle.strokeDasharray,
                              strokeWidth: lineStyle.strokeWidth,
                              dot: lineStyle.dot || false,
                            })}
                            <span className="text-xs text-muted-foreground">Mentions</span>
                          </div>
                        )}
                        {showSentiment && (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              {renderLineIndicator(positiveColor, {
                                strokeDasharray: "10 5",
                                strokeWidth: 2.5,
                                dot: false,
                              })}
                              {renderLineIndicator(negativeColor, {
                                strokeDasharray: "5 3 2 3",
                                strokeWidth: 2.5,
                                dot: false,
                              })}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Sentiments (Positive/ Negative)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : view === "timeline" ? (
          <div className="text-center py-12 text-muted-foreground">
            {selectedBrands.length === 0
              ? "Select brands to view timeline"
              : "No brand mentions found for the selected brands and date range"}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
