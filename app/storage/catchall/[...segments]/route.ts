import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  console.log("[Storage] Catch-all route hit");
  const params = await context.params;
  console.log("[Storage] Segments:", params.segments);

  return NextResponse.json({
    message: "Catch-all route working",
    segments: params.segments,
  });
}
