import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { v4 as uuidv4 } from "uuid";
import { initializeStorageProvider, getStorageProvider } from "crunchycone-lib/services/storage";

export const dynamic = "force-dynamic";

interface UploadResult {
  success: boolean;
  fileName: string;
  filePath: string;
  size: number;
  contentType: string;
  visibility: "public" | "private";
  url?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session || !(await hasRole(session.user.id, "admin"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const visibility = (formData.get("visibility") as string) || "private";
    const folder = (formData.get("folder") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 50 * 1024 * 1024) {
      // 50MB limit
      return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
    }

    // Initialize storage provider if not already done
    try {
      initializeStorageProvider();
    } catch {
      // Provider might already be initialized
    }

    const provider = getStorageProvider();

    // Generate unique filename to prevent conflicts
    const fileExtension = file.name.split(".").pop() || "";
    const uniqueId = uuidv4().slice(0, 8);
    const baseFileName = file.name.replace(/\.[^/.]+$/, "");
    const fileName = `${baseFileName}-${uniqueId}${fileExtension ? `.${fileExtension}` : ""}`;

    // Handle folder structure
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    try {
      // Upload file using the storage provider
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      console.log(
        `[Upload] Starting upload for ${filePath}, size: ${file.size}, type: ${file.type}`
      );

      const uploadResult = await provider.uploadFile({
        external_id: `admin-upload-${uniqueId}`,
        key: filePath,
        filename: file.name,
        buffer: buffer,
        contentType: file.type,
        size: file.size,
        public: visibility === "public",
        metadata: {
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          uploadedBy: session.user.id,
        },
      });

      console.log(`[Upload] Upload successful for ${filePath}:`, uploadResult);

      const result: UploadResult = {
        success: true,
        fileName,
        filePath: uploadResult.key,
        size: uploadResult.size,
        contentType: uploadResult.contentType,
        visibility: uploadResult.visibility as "public" | "private",
      };

      // Add URL for public files
      if (uploadResult.publicUrl) {
        result.url = uploadResult.publicUrl;
      }

      return NextResponse.json(result);
    } catch (error) {
      console.error(`[Upload] Error uploading file ${filePath}:`, error);
      console.error(`[Upload] Error details:`, {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return NextResponse.json(
        {
          error: "Upload failed",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  } catch {
    // Error handled silently
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
