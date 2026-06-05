"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface ConversationFilterFormProps {
  projectId?: string; // Optional for create form
  initialThresholds: {
    linkedin: number | null;
    facebook: number | null;
    twitter: number | null;
  };
  formId?: string; // Form ID to attach hidden inputs to (default: "edit-project-form")
}

// Convert threshold value (0-30) to slider position (0-100)
// 0 = no filter (left), 30 = high filter (right)
// Middle (50%) = 15
const valueToSlider = (value: number | null): number => {
  if (value === null || value === 0) return 0;
  if (value >= 30) return 100;
  // Linear mapping: 0-30 maps to 0-100
  return Math.round((value / 30) * 100);
};

// Convert slider position (0-100) to threshold value (0-30)
const sliderToValue = (sliderValue: number): number | null => {
  if (sliderValue === 0) return null; // null means no filter
  // Linear mapping: 0-100 maps to 0-30
  return Math.round((sliderValue / 100) * 30);
};

export function EngagementThresholdsForm({
  projectId,
  initialThresholds,
  formId = "edit-project-form",
}: ConversationFilterFormProps) {
  const [sliders, setSliders] = useState({
    linkedin: valueToSlider(initialThresholds.linkedin),
    facebook: valueToSlider(initialThresholds.facebook),
    twitter: valueToSlider(initialThresholds.twitter),
  });

  const getFilterLabel = (sliderValue: number): string => {
    if (sliderValue === 0) return "No Filter";
    if (sliderValue === 100) return "High Filter";
    const value = sliderToValue(sliderValue);
    return value !== null ? `${value}` : "No Filter";
  };

  const platforms = [
    { key: "linkedin" as const, label: "LinkedIn" },
    { key: "facebook" as const, label: "Facebook" },
    { key: "twitter" as const, label: "Twitter (X)" },
  ];

  return (
    <div className="space-y-6">
      {/* Hidden inputs for the form */}
      <input
        type="hidden"
        id="linkedin_engagement_threshold"
        name="linkedin_engagement_threshold"
        form={formId}
        value={sliderToValue(sliders.linkedin) ?? ""}
      />
      <input
        type="hidden"
        id="facebook_engagement_threshold"
        name="facebook_engagement_threshold"
        form={formId}
        value={sliderToValue(sliders.facebook) ?? ""}
      />
      <input
        type="hidden"
        id="twitter_engagement_threshold"
        name="twitter_engagement_threshold"
        form={formId}
        value={sliderToValue(sliders.twitter) ?? ""}
      />

      <div className="grid gap-8 md:grid-cols-3">
        {platforms.map((platform) => (
          <div key={platform.key} className="space-y-3">
            <Label htmlFor={`${platform.key}-filter`} className="text-base font-medium">
              {platform.label}
            </Label>
            <div className="space-y-2">
              <div className="flex justify-center">
                <span className="text-sm font-semibold text-muted-foreground">
                  {getFilterLabel(sliders[platform.key])}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16">No Filter</span>
                <Slider
                  id={`${platform.key}-filter`}
                  value={[sliders[platform.key]]}
                  onValueChange={(value) => setSliders({ ...sliders, [platform.key]: value[0] })}
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-16 text-right">High Filter</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
