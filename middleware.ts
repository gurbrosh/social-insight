import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const startTime = Date.now();

  // Log incoming request (if detailed logging is enabled)
  if (process.env.LOG_LEVEL === "debug") {
    // Use console.log directly in middleware for Edge Runtime compatibility
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "debug",
      message: `Incoming Request: ${request.method} ${pathname}`,
      meta: {
        method: request.method,
        url: request.url,
        pathname: pathname,
        userAgent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
        ip: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
      },
    };
    console.log(JSON.stringify(logEntry));
  }

  // Skip middleware for static files and API routes (except auth)
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.includes(".") ||
    (pathname.startsWith("/api") && !pathname.startsWith("/api/auth"))
  ) {
    return NextResponse.next();
  }

  // Add the current pathname to headers so server components can access it
  const response = NextResponse.next();
  response.headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);

  // Log response (if detailed logging is enabled)
  if (process.env.LOG_LEVEL === "debug") {
    const duration = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: "debug",
      message: `Response: ${request.method} ${pathname} ${response.status}`,
      meta: {
        method: request.method,
        url: request.url,
        pathname: pathname,
        status: response.status,
        duration: `${duration}ms`,
      },
    };
    console.log(JSON.stringify(logEntry));
  }

  // Add security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
