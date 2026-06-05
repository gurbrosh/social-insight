import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { Toaster } from "@/components/ui/toaster";
import { DebugBubble } from "@/components/DebugBubble";
import { startOrchestrationRunner } from "@/lib/orchestration-runner";
import "./globals.css";

// Initialize structured logging for production
import "@/lib/utils/logger";

// Global error handlers to catch unhandled Prisma errors (register once per process to avoid MaxListenersExceededWarning in dev)
if (typeof window === "undefined") {
  const key = "__globalRejectionHandlersRegistered";
  if (!(globalThis as unknown as Record<string, boolean>)[key]) {
    (globalThis as unknown as Record<string, boolean>)[key] = true;
    process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
      const errorDetails =
        reason && typeof reason === "object" && "name" in reason
          ? {
              name: (reason as Error).name,
              message: (reason as Error).message,
              code: (reason as { code?: string }).code,
              meta: (reason as { meta?: unknown }).meta,
              cause: (reason as { cause?: unknown }).cause,
              clientVersion: (reason as { clientVersion?: string }).clientVersion,
              digest: (reason as { digest?: string }).digest,
              stack: (reason as Error).stack,
            }
          : reason;
      console.error("[Global] Unhandled Promise Rejection:", JSON.stringify(errorDetails, null, 2));
    });

    process.on("uncaughtException", (error: Error) => {
      const errorDetails =
        error && typeof error === "object" && "name" in error
          ? {
              name: (error as Error).name,
              message: (error as Error).message,
              code: (error as { code?: string }).code,
              meta: (error as { meta?: unknown }).meta,
              cause: (error as { cause?: unknown }).cause,
              clientVersion: (error as { clientVersion?: string }).clientVersion,
              digest: (error as { digest?: string }).digest,
              stack: error.stack,
            }
          : error;
      console.error("[Global] Uncaught Exception:", JSON.stringify(errorDetails, null, 2));
    });
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Start orchestration runner on the server at runtime (but NOT during `next build`).
// Next.js may evaluate Server Components during build to collect page data; we must not
// start background workers or hit the database in that phase.
if (typeof window === "undefined") {
  const isNextBuildPhase =
    process?.env?.npm_lifecycle_event === "build" ||
    process?.env?.NEXT_PHASE === "phase-production-build" ||
    process?.env?.NEXT_PHASE === "phase-export";

  if (!isNextBuildPhase) {
    try {
      // Start asynchronously to avoid blocking initial render
      Promise.resolve().then(() => {
        try {
          startOrchestrationRunner();
        } catch (error) {
          console.error("Error starting orchestration runner:", error);
        }
      });
    } catch (error) {
      console.error("Error setting up orchestration runner:", error);
      // Continue execution even if orchestration runner fails
    }
  }
}

export const metadata: Metadata = {
  title: "CrunchyCone Vanilla Starter Project",
  description: "A production-ready Next.js starter with auth and admin dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  try {
    return (
      <html lang="en" suppressHydrationWarning>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <SessionProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              themes={["light", "dark", "system", "ocean", "forest", "midnight"]}
              disableTransitionOnChange
            >
              {children}
              <DebugBubble />
              <Toaster />
            </ThemeProvider>
          </SessionProvider>
        </body>
      </html>
    );
  } catch (error) {
    console.error("[Layout] Error in RootLayout:", error);
    console.error("[Layout] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    return (
      <html lang="en">
        <body>
          <h1>Layout Error</h1>
          <pre>{error instanceof Error ? error.message : String(error)}</pre>
        </body>
      </html>
    );
  }
}
