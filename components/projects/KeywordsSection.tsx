"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";
import { KeywordSuggestions, KeywordSuggestion } from "./KeywordSuggestions";
import { parseKeywords } from "./KeywordsInput";
import { toast } from "@/hooks/use-toast";

interface KeywordsSectionProps {
  value: string;
  onChange: (value: string) => void;
  maxTotal?: number; // Max total items (keywords + brands combined)
  currentBrandCount?: number; // Current number of brands selected
  selectedBrandIds?: string[]; // Brand IDs for cross-suggestion
}

export function KeywordsSection({
  value,
  onChange,
  maxTotal = 12,
  currentBrandCount = 0,
  selectedBrandIds = [],
}: KeywordsSectionProps) {
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);

  const keywords = parseKeywords(value);
  const maxKeywords = Math.max(0, maxTotal - currentBrandCount);
  const remainingSlots = maxKeywords - keywords.length;

  const handleSuggest = async () => {
    // Allow suggestions if we have keywords OR brands
    if (keywords.length === 0 && selectedBrandIds.length === 0) {
      toast({
        title: "Keywords or brands required",
        description:
          "Please add at least one keyword or select at least one brand to get suggestions.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingSuggestions(true);
    try {
      const response = await fetch("/api/projects/suggest-keywords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          keywords: keywords.length > 0 ? keywords : [],
          excludeKeywords: keywords,
          brandIds: selectedBrandIds.length > 0 ? selectedBrandIds : [],
          limit: 20,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch suggestions");
      }

      const data = await response.json();
      setSuggestions(data.suggestions || []);
    } catch (error) {
      console.error("Error fetching keyword suggestions:", error);
      toast({
        title: "Error",
        description: "Failed to fetch keyword suggestions. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleAdoptKeyword = (keyword: string) => {
    if (keywords.length >= maxKeywords) {
      toast({
        title: "Limit reached",
        description: `You can only add up to ${maxKeywords} keywords (${maxTotal} total items including brands).`,
        variant: "destructive",
      });
      return;
    }

    // Add keyword if not already present
    const keywordLower = keyword.toLowerCase().trim();
    if (!keywords.some((k) => k.toLowerCase().trim() === keywordLower)) {
      const newKeywords = [...keywords, keyword];
      onChange(newKeywords.join(", "));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Keywords to Monitor</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSuggest}
            disabled={
              isLoadingSuggestions || (keywords.length === 0 && selectedBrandIds.length === 0)
            }
            className="flex items-center gap-2"
          >
            {isLoadingSuggestions ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Suggest
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="keywords">Keywords</Label>
          <Textarea
            id="keywords"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter keywords separated by commas: software development, cloud application, vibe coding, security"
            rows={3}
          />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {keywords.length}/{maxKeywords} keywords
              {currentBrandCount > 0 && (
                <span className="ml-1">({currentBrandCount} brands selected)</span>
              )}
            </span>
            <span>Separate multiple keywords with commas</span>
          </div>
          {remainingSlots <= 0 && keywords.length > 0 && (
            <p className="text-sm text-destructive">
              Maximum keywords reached. Remove some keywords or brands to add more.
            </p>
          )}
        </div>

        {suggestions.length > 0 && (
          <KeywordSuggestions
            suggestions={suggestions}
            onAdopt={handleAdoptKeyword}
            adoptedKeywords={keywords}
          />
        )}
      </CardContent>
    </Card>
  );
}
