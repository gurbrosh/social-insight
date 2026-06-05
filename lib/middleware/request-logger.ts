/**
 * Request Logging Middleware
 *
 * Logs HTTP requests in structured JSON format for production
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/utils/logger";

export function requestLogger(request: NextRequest, _response?: NextResponse) {
  const startTime = Date.now();
  const { method, url, headers } = request;

  // Extract relevant headers (without sensitive info)
  const userAgent = headers.get("user-agent") || "unknown";
  const ip = headers.get("x-forwarded-for") || headers.get("x-real-ip") || "unknown";
  const referer = headers.get("referer");

  // Sanitize URL to remove query parameters that might contain PII
  const sanitizedUrl = url.split("?")[0];

  // Log request start
  logger.info("Request Started", {
    method,
    url: sanitizedUrl,
    userAgent,
    ip,
    referer,
  });

  // Return a function to log completion
  return (response?: NextResponse, error?: Error) => {
    const duration = Date.now() - startTime;
    const statusCode = response?.status || (error ? 500 : 200);

    if (error) {
      logger.error("Request Failed", error, {
        method,
        url: sanitizedUrl,
        statusCode,
        duration: `${duration}ms`,
        ip,
      });
    } else {
      logger.info("Request Completed", {
        method,
        url: sanitizedUrl,
        statusCode,
        duration: `${duration}ms`,
        ip,
      });
    }
  };
}

// Middleware wrapper for easy use in middleware.ts
export function withRequestLogging(
  handler: (req: NextRequest) => Promise<NextResponse> | NextResponse
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const logCompletion = requestLogger(request);

    try {
      const response = await handler(request);
      logCompletion(response);
      return response;
    } catch (error) {
      logCompletion(undefined, error as Error);
      throw error;
    }
  };
}
