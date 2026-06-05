"use client";

import * as React from "react";
import { Moon, Sun, Palette, Waves, Trees, Clock } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

import { getThemesByCategory } from "@/themes";

// Icon mapping for dynamic icons
const iconMap = {
  Sun,
  Moon,
  Palette,
  Waves,
  Trees,
  Clock,
} as const;

export function ThemeToggle() {
  const { setTheme } = useTheme();

  const baseThemes = getThemesByCategory("base");
  const customThemes = getThemesByCategory("custom");

  const getIconComponent = (iconName?: string) => {
    if (!iconName || !(iconName in iconMap)) return Palette;
    return iconMap[iconName as keyof typeof iconMap];
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Base themes */}
        {baseThemes.map((theme) => {
          const IconComponent = getIconComponent(theme.icon);
          return (
            <DropdownMenuItem key={theme.name} onClick={() => setTheme(theme.name)}>
              <IconComponent className="mr-2 h-4 w-4" />
              {theme.label}
            </DropdownMenuItem>
          );
        })}

        {/* System theme */}
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Palette className="mr-2 h-4 w-4" />
          System
        </DropdownMenuItem>

        {/* Custom themes */}
        {customThemes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Custom Themes</DropdownMenuLabel>
            {customThemes.map((theme) => {
              const IconComponent = getIconComponent(theme.icon);
              return (
                <DropdownMenuItem key={theme.name} onClick={() => setTheme(theme.name)}>
                  <IconComponent className="mr-2 h-4 w-4" />
                  <span className="flex items-center gap-1">
                    {theme.emoji && <span>{theme.emoji}</span>}
                    {theme.label}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
