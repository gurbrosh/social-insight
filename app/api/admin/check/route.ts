import { NextResponse } from "next/server";
import { checkAdminExists } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const adminExists = await checkAdminExists();

    return NextResponse.json({
      adminExists,
    });
  } catch (error) {
    console.error("Error in admin check API:", error);

    return NextResponse.json(
      {
        adminExists: false,
        error: "Failed to check admin status",
      },
      { status: 500 }
    );
  }
}
