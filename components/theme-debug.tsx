"use client";

import * as React from "react";
import { useTheme } from "next-themes";

export function ThemeDebug() {
  const { theme, resolvedTheme, systemTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 p-3 bg-card border rounded-lg shadow-lg text-xs font-mono z-50">
      <div>Current: {theme}</div>
      <div>Resolved: {resolvedTheme}</div>
      <div>System: {systemTheme}</div>
      <div>
        HTML Class: {typeof document !== "undefined" ? document.documentElement.className : "N/A"}
      </div>
    </div>
  );
}
