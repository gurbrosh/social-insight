import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  console.log("[Storage] Test dynamic route hit");
  const params = await context.params;
  console.log("[Storage] Slug:", params.slug);

  return NextResponse.json({ message: `Dynamic route working: ${params.slug}` });
}
