"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export interface KeywordSuggestion {
  keyword: string;
  source: "brand_keyword" | "taxonomy";
  relevanceScore: number;
  matchType: "exact" | "contains" | "fuzzy";
}

interface KeywordSuggestionsProps {
  suggestions: KeywordSuggestion[];
  onAdopt: (keyword: string) => void;
  adoptedKeywords: string[];
}

export function KeywordSuggestions({
  suggestions,
  onAdopt,
  adoptedKeywords,
}: KeywordSuggestionsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  const adoptedSet = new Set(adoptedKeywords.map((k) => k.toLowerCase().trim()));

  return (
    <div className="mt-4 space-y-2">
      <div className="text-sm font-medium text-muted-foreground">Suggested Keywords</div>
      <div className="flex flex-wrap gap-2">
        {suggestions
          .filter((s) => {
            const keywordLower = s.keyword.toLowerCase().trim();
            return keywordLower && !adoptedSet.has(keywordLower);
          })
          .map((suggestion, index) => (
            <Badge
              key={suggestion.keyword || `keyword-suggestion-${index}`}
              variant="outline"
              className="cursor-pointer hover:bg-accent"
              onClick={() => onAdopt(suggestion.keyword)}
            >
              <Plus className="h-3 w-3 mr-1" />
              {suggestion.keyword}
              {suggestion.relevanceScore > 0 && (
                <span className="ml-1 text-xs opacity-70">({suggestion.relevanceScore}%)</span>
              )}
            </Badge>
          ))}
      </div>
    </div>
  );
}
