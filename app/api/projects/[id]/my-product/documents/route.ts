import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertProjectOwner } from "@/lib/my-product/assert-project-owner";
import { initializeStorageProvider, getStorageProvider } from "crunchycone-lib/services/storage";
import { generateId } from "@/lib/utils/ulid";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

function safeFileSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180) || "file";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const ok = await assertProjectOwner(projectId, session.user.id);
    if (!ok) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
    }

    try {
      initializeStorageProvider();
    } catch {
      // ok
    }

    const provider = getStorageProvider();
    const bytes = Buffer.from(await file.arrayBuffer());
    const unique = generateId().slice(0, 12);
    const safeName = safeFileSegment(file.name);
    const storageKey = `projects/${projectId}/my-product/${unique}-${safeName}`;

    await provider.uploadFile({
      external_id: `my-product-${projectId}-${unique}`,
      key: storageKey,
      filename: file.name,
      buffer: bytes,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      public: false,
      metadata: {
        projectId,
        purpose: "my_product_document",
        uploadedAt: new Date().toISOString(),
        uploadedBy: session.user.id,
      },
    });

    const row = await prisma.projectMyProductDocument.create({
      data: {
        project_id: projectId,
        storage_key: storageKey,
        original_filename: file.name,
        content_type: file.type || null,
        byte_size: file.size,
      },
      select: {
        id: true,
        original_filename: true,
        byte_size: true,
        content_type: true,
        created_at: true,
      },
    });

    return NextResponse.json({ success: true, document: row });
  } catch (e) {
    console.error("[my-product/documents] POST", e);
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
