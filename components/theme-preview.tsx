"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAllThemes } from "@/themes";

export function ThemePreview() {
  const { theme, setTheme } = useTheme();
  const allThemes = getAllThemes();

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle>Theme Preview</CardTitle>
        <CardDescription>
          Experience all available themes. Current theme: <Badge variant="secondary">{theme}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allThemes.map((themeOption) => (
            <Card
              key={themeOption.name}
              className={`cursor-pointer transition-all hover:shadow-lg ${
                theme === themeOption.name ? "ring-2 ring-primary" : ""
              }`}
              onClick={() => setTheme(themeOption.name)}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {themeOption.emoji && <span>{themeOption.emoji}</span>}
                  {themeOption.label}
                  {themeOption.category === "custom" && (
                    <Badge variant="outline" className="text-xs">
                      Custom
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">{themeOption.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="flex space-x-2">
                    <div className="w-4 h-4 rounded bg-background border"></div>
                    <div className="w-4 h-4 rounded bg-primary"></div>
                    <div className="w-4 h-4 rounded bg-secondary"></div>
                    <div className="w-4 h-4 rounded bg-accent"></div>
                  </div>
                  <Button size="sm" className="w-full">
                    Preview {themeOption.label}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 p-4 border rounded-lg">
          <h3 className="text-sm font-medium mb-2">Color Palette</h3>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="p-2 bg-background border rounded text-center">Background</div>
            <div className="p-2 bg-primary text-primary-foreground rounded text-center">
              Primary
            </div>
            <div className="p-2 bg-secondary text-secondary-foreground rounded text-center">
              Secondary
            </div>
            <div className="p-2 bg-accent text-accent-foreground rounded text-center">Accent</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
