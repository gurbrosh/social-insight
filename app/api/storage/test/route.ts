import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[Storage Test] Route hit successfully");
  return NextResponse.json({ message: "Storage API is working" });
}
