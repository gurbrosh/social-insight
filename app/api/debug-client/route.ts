import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ClientError {
  type: "runtime" | "build" | "unhandled";
  message: string;
  stack?: string;
  timestamp: string;
  url?: string;
  userAgent?: string;
}

export async function POST(request: NextRequest) {
  // Only allow this endpoint in development mode
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  try {
    const errorData: ClientError = await request.json();

    // Log client-side error in a clear, concise format
    console.error(`🚨 CLIENT-SIDE ERROR: ${errorData.message}`);
    if (errorData.stack) {
      console.error(errorData.stack);
    }

    return NextResponse.json({ success: true, logged: true });
  } catch (error) {
    console.error("❌ Error processing client-side error report:", error);
    return NextResponse.json({ error: "Failed to process error report" }, { status: 500 });
  }
}

// Only allow POST requests
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  return NextResponse.json({
    message: "Client debug endpoint is active",
    environment: "development",
  });
}
