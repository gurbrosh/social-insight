"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, AlertCircle, CheckCircle, Move, Copy } from "lucide-react";
import Image from "next/image";

interface ErrorInfo {
  id: string;
  type: "runtime" | "build" | "unhandled";
  message: string;
  stack?: string;
  timestamp: Date;
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface Position {
  x: number;
  y: number;
}

export function DebugBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [buildTime, setBuildTime] = useState<string>("N/A");
  const [renderTime, setRenderTime] = useState<string>("N/A");
  const [errors, setErrors] = useState<ErrorInfo[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [buildStatus, setBuildStatus] = useState<"building" | "success" | "error">("success");
  const [copiedErrorId, setCopiedErrorId] = useState<string | null>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-left");
  const [position, setPosition] = useState<Position>({ x: 16, y: 16 }); // Will be set in useEffect
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Send error to server for logging
  const sendErrorToServer = useCallback(async (error: ErrorInfo) => {
    if (process.env.NODE_ENV !== "development") return;

    try {
      await fetch("/api/debug-client", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: error.type,
          message: error.message,
          stack: error.stack,
          timestamp: error.timestamp.toISOString(),
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      });
    } catch (err) {
      console.warn("Failed to send error to server:", err);
    }
  }, []);

  const addError = useCallback(
    (error: Omit<ErrorInfo, "id" | "timestamp">) => {
      const errorWithMeta = {
        ...error,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
      };

      setErrors((prev) => [...prev, errorWithMeta]);
      setShowErrors(true);

      // Send to server for logging
      sendErrorToServer(errorWithMeta);
    },
    [sendErrorToServer]
  );

  const clearErrors = useCallback(() => {
    setErrors([]);
    setShowErrors(false);
  }, []);

  const copyError = useCallback(async (error: ErrorInfo) => {
    try {
      const errorDetails = [
        `Error Type: ${error.type.toUpperCase()}`,
        `Message: ${error.message}`,
        `Timestamp: ${error.timestamp.toISOString()}`,
        error.stack ? `Stack Trace:\n${error.stack}` : "",
        `URL: ${window.location.href}`,
        `User Agent: ${navigator.userAgent}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      await navigator.clipboard.writeText(errorDetails);
      setCopiedErrorId(error.id);

      // Clear the copied state after 2 seconds
      setTimeout(() => {
        setCopiedErrorId(null);
      }, 2000);
    } catch (err) {
      console.warn("Failed to copy error details:", err);
      // Fallback for browsers that don't support clipboard API
      try {
        const textarea = document.createElement("textarea");
        textarea.value = `Error: ${error.message}\nStack: ${error.stack || "No stack trace"}`;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopiedErrorId(error.id);
        setTimeout(() => setCopiedErrorId(null), 2000);
      } catch (fallbackErr) {
        console.warn("Fallback copy also failed:", fallbackErr);
      }
    }
  }, []);

  // Calculate which corner is closest
  const getClosestCorner = useCallback(
    (x: number, y: number): Corner => {
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const threshold = 150; // Distance threshold for snapping

      const distances = {
        "top-left": Math.sqrt(x ** 2 + y ** 2),
        "top-right": Math.sqrt((windowWidth - x) ** 2 + y ** 2),
        "bottom-left": Math.sqrt(x ** 2 + (windowHeight - y) ** 2),
        "bottom-right": Math.sqrt((windowWidth - x) ** 2 + (windowHeight - y) ** 2),
      };

      let closestCorner: Corner = "bottom-left";
      let minDistance = Infinity;

      for (const [corner, distance] of Object.entries(distances)) {
        if (distance < minDistance) {
          minDistance = distance;
          closestCorner = corner as Corner;
        }
      }

      // Only snap if within threshold
      return minDistance < threshold ? closestCorner : corner;
    },
    [corner]
  );

  // Get position for a specific corner
  const getCornerPosition = useCallback((corner: Corner): Position => {
    const margin = 16;
    const size = 48; // Bubble size
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    switch (corner) {
      case "top-left":
        return { x: margin, y: margin };
      case "top-right":
        return { x: windowWidth - size - margin, y: margin };
      case "bottom-left":
        return { x: margin, y: windowHeight - size - margin };
      case "bottom-right":
        return { x: windowWidth - size - margin, y: windowHeight - size - margin };
    }
  }, []);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    if (bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      setDragOffset({
        x: clientX - rect.left,
        y: clientY - rect.top,
      });
      setIsDragging(true);
    }
  }, []);

  // Handle drag move
  const handleDragMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;

      e.preventDefault();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      const newX = clientX - dragOffset.x;
      const newY = clientY - dragOffset.y;

      // Update position
      setPosition({ x: newX, y: newY });

      // Check for corner snapping
      const bubbleCenter = {
        x: newX + 24, // Half of bubble size
        y: newY + 24,
      };

      const newCorner = getClosestCorner(bubbleCenter.x, bubbleCenter.y);
      if (newCorner !== corner) {
        setCorner(newCorner);
      }
    },
    [isDragging, dragOffset, corner, getClosestCorner]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);

    // Snap to corner
    const cornerPos = getCornerPosition(corner);
    setPosition(cornerPos);

    // Save position to localStorage
    localStorage.setItem("debugBubbleCorner", corner);
  }, [isDragging, corner, getCornerPosition]);

  // Load saved position on mount
  useEffect(() => {
    const savedCorner = localStorage.getItem("debugBubbleCorner") as Corner | null;
    if (savedCorner) {
      setCorner(savedCorner);
      const cornerPos = getCornerPosition(savedCorner);
      setPosition(cornerPos);
    } else {
      // Set initial position based on default corner
      const cornerPos = getCornerPosition("bottom-left");
      setPosition(cornerPos);
    }
  }, [getCornerPosition]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      // Reposition to current corner when window resizes
      const cornerPos = getCornerPosition(corner);
      setPosition(cornerPos);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [corner, getCornerPosition]);

  // Add drag event listeners
  useEffect(() => {
    if (isDragging) {
      const handleMove = (e: MouseEvent | TouchEvent) => handleDragMove(e);
      const handleEnd = () => handleDragEnd();

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleEnd);
      document.addEventListener("touchmove", handleMove, { passive: false });
      document.addEventListener("touchend", handleEnd);

      return () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
        document.removeEventListener("touchmove", handleMove);
        document.removeEventListener("touchend", handleEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    // Calculate render time
    const startTime = performance.now();
    setRenderTime(`${(performance.now() - startTime).toFixed(2)}ms`);

    // Get build time from Next.js build ID or use current time as fallback
    const buildId = process.env.NEXT_PUBLIC_BUILD_ID || Date.now().toString();
    setBuildTime(new Date(parseInt(buildId)).toLocaleString());

    // Listen for runtime errors
    const handleError = (event: ErrorEvent) => {
      // Filter out Next.js internal errors
      if (
        event.filename?.includes("next-devtools") ||
        event.filename?.includes("webpack") ||
        event.filename?.includes("hot-reloader") ||
        event.message?.includes("ResizeObserver") ||
        event.message?.includes("Non-Error promise rejection captured")
      ) {
        return;
      }

      addError({
        type: "runtime",
        message: event.message,
        stack: event.error?.stack,
      });
    };

    // Listen for unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      // Filter out common non-critical rejections
      const reason = event.reason?.message || String(event.reason);
      if (
        reason.includes("ResizeObserver") ||
        reason.includes("Non-Error promise rejection") ||
        reason.includes("next-devtools")
      ) {
        return;
      }

      addError({
        type: "unhandled",
        message: reason,
        stack: event.reason?.stack,
      });
    };

    // Listen for Next.js specific errors via custom events
    const handleNextError = (event: CustomEvent) => {
      addError({
        type: "build",
        message: event.detail?.message || "Build error",
        stack: event.detail?.stack,
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("next-error", handleNextError as EventListener);

    // Monitor webpack HMR status
    interface WebpackReporter {
      onBuildError?: (err: { message?: string; stack?: string }) => void;
      onBuildOk?: () => void;
    }

    if (
      typeof window !== "undefined" &&
      (window as unknown as { __webpack_hot_middleware_reporter__?: WebpackReporter })
        .__webpack_hot_middleware_reporter__
    ) {
      const reporter = (
        window as unknown as { __webpack_hot_middleware_reporter__: WebpackReporter }
      ).__webpack_hot_middleware_reporter__;
      const originalReporter = reporter.onBuildError;

      reporter.onBuildError = (err: { message?: string; stack?: string }) => {
        setBuildStatus("error");
        addError({
          type: "build",
          message: err.message || "Build error",
          stack: err.stack,
        });
        originalReporter?.(err);
      };

      const originalSuccess = reporter.onBuildOk;
      reporter.onBuildOk = () => {
        setBuildStatus("success");
        originalSuccess?.();
      };
    }

    // Hide Next.js indicator with a more aggressive approach
    const hideNextIndicator = () => {
      const style = document.createElement("style");
      style.innerHTML = `
        nextjs-portal,
        #__next-build-indicator,
        [class*="nextjs-"],
        [id*="nextjs-"],
        div[style*="position: fixed"][style*="z-index: 99999"],
        div[style*="position:fixed"][style*="z-index:99999"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(style);

      // Also try to remove the element directly
      const indicators = document.querySelectorAll(
        'nextjs-portal, [class*="nextjs-"], [id*="nextjs-"]'
      );
      indicators.forEach((el) => el.remove());
    };

    // Run immediately and after a delay to catch late-loading indicators
    hideNextIndicator();
    setTimeout(hideNextIndicator, 100);
    setTimeout(hideNextIndicator, 500);
    setTimeout(hideNextIndicator, 1000);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("next-error", handleNextError as EventListener);
    };
  }, [addError]);

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  // Calculate panel position based on bubble corner
  const getPanelStyle = () => {
    const margin = 16;

    switch (corner) {
      case "top-left":
        return { top: 64 + margin, left: margin };
      case "top-right":
        return { top: 64 + margin, right: margin };
      case "bottom-left":
        return { bottom: 64 + margin, left: margin };
      case "bottom-right":
        return { bottom: 64 + margin, right: margin };
    }
  };

  return (
    <>
      {/* Debug Bubble */}
      <div
        ref={bubbleRef}
        id="crunchycone-debug-bubble"
        className={`fixed z-[999999] flex h-12 w-12 items-center justify-center rounded-full bg-black/90 text-2xl shadow-lg ring-1 ring-white/10 transition-transform dark:bg-white/90 dark:ring-black/10 select-none ${
          isDragging
            ? "cursor-grabbing scale-110"
            : "cursor-grab hover:scale-110 hover:bg-black dark:hover:bg-white"
        } ${isDragging ? "" : "transition-all duration-300 ease-out"}`}
        style={{
          zIndex: 999999,
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: isDragging ? "scale(1.1)" : undefined,
        }}
        role="button"
        aria-label="Open debug panel or drag to reposition"
      >
        {/* Drag handle */}
        <div
          className="absolute inset-0 flex items-center justify-center rounded-full"
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          onClick={(e) => {
            if (!isDragging) {
              e.stopPropagation();
              setIsOpen(true);
              // Open errors tab if there are errors, otherwise info tab
              setShowErrors(errors.length > 0);
            }
          }}
        >
          <Image
            src="/crunchycone.svg"
            alt="CrunchyCone"
            width={24}
            height={24}
            className="pointer-events-none"
            style={{ width: "auto", height: "auto" }}
          />
        </div>

        {/* Drag indicator */}
        {isDragging && (
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-black/80 text-white text-[10px] whitespace-nowrap pointer-events-none">
            <Move className="inline h-3 w-3 mr-1" />
            Drag to corner
          </div>
        )}

        {/* Error badge */}
        {errors.length > 0 && (
          <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white pointer-events-none">
            {errors.length}
          </div>
        )}

        {/* Build status indicator */}
        {buildStatus === "building" && (
          <div className="absolute inset-0 rounded-full border-2 border-yellow-500 animate-pulse pointer-events-none" />
        )}
      </div>

      {/* Debug Panel */}
      {isOpen && (
        <div
          className="fixed z-[999998] w-80 rounded-lg bg-black/90 p-4 text-white shadow-2xl ring-1 ring-white/10 dark:bg-white/90 dark:text-black dark:ring-black/10"
          style={{
            zIndex: 999998,
            ...getPanelStyle(),
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">CrunchyCone Debug</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 hover:bg-white/10 dark:hover:bg-black/10"
              aria-label="Close debug panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="mb-3 flex gap-2 border-b border-white/10 dark:border-black/10">
            <button
              onClick={() => setShowErrors(false)}
              className={`pb-2 px-1 text-xs font-medium transition-colors ${
                !showErrors
                  ? "text-white dark:text-black border-b-2 border-white dark:border-black"
                  : "text-white/60 dark:text-black/60 hover:text-white/80 dark:hover:text-black/80"
              }`}
            >
              Info
            </button>
            <button
              onClick={() => setShowErrors(true)}
              className={`pb-2 px-1 text-xs font-medium transition-colors flex items-center gap-1 ${
                showErrors
                  ? "text-white dark:text-black border-b-2 border-white dark:border-black"
                  : "text-white/60 dark:text-black/60 hover:text-white/80 dark:hover:text-black/80"
              }`}
            >
              Errors
              {errors.length > 0 && (
                <span className="px-1 rounded bg-red-500 text-white text-[10px]">
                  {errors.length}
                </span>
              )}
            </button>
          </div>

          <div className="space-y-2 text-xs">
            {!showErrors ? (
              <>
                <div className="flex justify-between">
                  <span className="text-white/70 dark:text-black/70">Environment:</span>
                  <span className="font-mono">{process.env.NODE_ENV}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70 dark:text-black/70">Next.js Version:</span>
                  <span className="font-mono">{process.env.NEXT_RUNTIME || "15.x"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70 dark:text-black/70">Render Time:</span>
                  <span className="font-mono">{renderTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70 dark:text-black/70">Build Time:</span>
                  <span className="font-mono text-[10px]">{buildTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70 dark:text-black/70">Build Status:</span>
                  <span className="flex items-center gap-1">
                    {buildStatus === "success" && (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    )}
                    {buildStatus === "error" && <AlertCircle className="h-3 w-3 text-red-500" />}
                    {buildStatus === "building" && (
                      <div className="h-3 w-3 rounded-full border-2 border-yellow-500 animate-pulse" />
                    )}
                    <span className="font-mono capitalize">{buildStatus}</span>
                  </span>
                </div>
                <div className="mt-3 border-t border-white/10 pt-3 dark:border-black/10">
                  <div className="flex justify-between">
                    <span className="text-white/70 dark:text-black/70">Powered by:</span>
                    <span className="font-mono flex items-center gap-1">
                      CrunchyCone
                      <Image
                        src="/crunchycone.svg"
                        alt="CrunchyCone"
                        width={12}
                        height={12}
                        style={{ width: "auto", height: "auto" }}
                      />
                    </span>
                  </div>
                </div>
              </>
            ) : (
              /* Errors Tab */
              <>
                {errors.length === 0 ? (
                  <div className="py-8 text-center text-white/60 dark:text-black/60">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p>No errors detected</p>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-white/70 dark:text-black/70">
                        Errors ({errors.length})
                      </span>
                      <button
                        onClick={clearErrors}
                        className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 dark:bg-black/10 dark:hover:bg-black/20"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {errors.map((error) => (
                        <div
                          key={error.id}
                          className="p-2 rounded bg-red-500/10 border border-red-500/20"
                        >
                          <div className="flex items-start gap-2">
                            <AlertCircle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="font-semibold text-red-500 text-[11px] uppercase">
                                  {error.type}
                                </div>
                                <button
                                  onClick={() => copyError(error)}
                                  className="p-1 rounded hover:bg-white/10 dark:hover:bg-black/10 transition-colors"
                                  title="Copy error details"
                                  disabled={copiedErrorId === error.id}
                                >
                                  {copiedErrorId === error.id ? (
                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <Copy className="h-3 w-3 text-white/60 dark:text-black/60" />
                                  )}
                                </button>
                              </div>
                              <div className="mt-1 text-white dark:text-black break-words">
                                {error.message}
                              </div>
                              {error.stack && (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[10px] text-white/60 dark:text-black/60 hover:text-white/80 dark:hover:text-black/80">
                                    Stack trace
                                  </summary>
                                  <pre className="mt-1 text-[10px] overflow-x-auto text-white/80 dark:text-black/80">
                                    {error.stack}
                                  </pre>
                                </details>
                              )}
                              <div className="mt-1 text-[10px] text-white/50 dark:text-black/50">
                                {error.timestamp.toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
