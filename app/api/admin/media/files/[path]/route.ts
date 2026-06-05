import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { initializeStorageProvider, getStorageProvider } from "crunchycone-lib/services/storage";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string }> }) {
  try {
    const session = await auth();

    if (!session || !(await hasRole(session.user.id, "admin"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const filePath = decodeURIComponent(params.path);
    const body = await request.json();
    const { visibility } = body;

    if (!["public", "private"].includes(visibility)) {
      return NextResponse.json({ error: "Invalid visibility value" }, { status: 400 });
    }

    // Initialize storage provider if not already done
    try {
      initializeStorageProvider();
    } catch {
      // Provider might already be initialized
    }

    const provider = getStorageProvider();

    // Check if file exists
    const fileExists = await provider.fileExists(filePath);
    if (!fileExists) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Update file visibility using the storage provider
    try {
      console.log(`[Visibility] Setting ${filePath} to ${visibility}`);
      const result = await provider.setFileVisibility(filePath, visibility);
      console.log(`[Visibility] Result:`, result);

      // Check the actual visibility after the change
      const actualVisibility = await provider.getFileVisibility(filePath);
      console.log(`[Visibility] Actual visibility after change:`, actualVisibility);

      return NextResponse.json({
        success: true,
        message: `File visibility changed to ${visibility}`,
        result,
        actualVisibility,
      });
    } catch (error) {
      // Error handled silently
      console.error(`[Visibility] Error changing visibility:`, error);
      return NextResponse.json(
        {
          error: "Failed to update file visibility",
        },
        { status: 500 }
      );
    }
  } catch {
    // Error handled silently
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ path: string }> }
) {
  try {
    const session = await auth();

    if (!session || !(await hasRole(session.user.id, "admin"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const filePath = decodeURIComponent(params.path);

    // Initialize storage provider if not already done
    try {
      initializeStorageProvider();
    } catch {
      // Provider might already be initialized
    }

    const provider = getStorageProvider();

    // Delete the file using the storage provider
    // Note: We always try to delete, even if the file doesn't exist, to ensure cleanup
    try {
      let wasDeleted = false;
      let errorMessage = "";

      try {
        await provider.deleteFile(filePath);
        wasDeleted = true;
        console.log(`[Delete] File ${filePath} deleted from storage`);
      } catch (deleteError) {
        // Even if delete fails, we consider it a success if it was a "not found" error
        const errorMsg = deleteError instanceof Error ? deleteError.message : String(deleteError);
        console.log(`[Delete] Delete operation for ${filePath} failed: ${errorMsg}`);

        if (
          errorMsg.toLowerCase().includes("not found") ||
          errorMsg.toLowerCase().includes("does not exist")
        ) {
          console.log(
            `[Delete] File ${filePath} was already missing, considering deletion successful`
          );
          wasDeleted = true;
        } else {
          errorMessage = errorMsg;
        }
      }

      if (wasDeleted) {
        return NextResponse.json({
          success: true,
          message: "File deleted successfully",
        });
      } else {
        throw new Error(errorMessage || "Failed to delete file");
      }
    } catch (error) {
      console.error(`[Delete] Error deleting file ${filePath}:`, error);
      return NextResponse.json(
        {
          error: "Failed to delete file",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  } catch {
    // Error handled silently
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
