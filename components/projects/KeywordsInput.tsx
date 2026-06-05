"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface KeywordsInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function KeywordsInput({
  value,
  onChange,
  placeholder = "Enter keywords separated by commas: software development, cloud application, vibe coding, security",
}: KeywordsInputProps) {
  const getKeywordsArray = () => parseKeywords(value);

  return (
    <div className="space-y-2">
      <Label htmlFor="keywords">Keywords to Monitor</Label>
      <Textarea
        id="keywords"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{getKeywordsArray().length}/20 keywords</span>
        <span>Separate multiple keywords with commas</span>
      </div>
    </div>
  );
}

export function parseKeywords(keywordsInput: string): string[] {
  return keywordsInput
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}
