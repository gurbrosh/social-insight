import { NextRequest, NextResponse } from "next/server";
import { lookup } from "mime-types";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

// Import crunchycone-lib types and functions
import {
  StorageProvider,
  FileStreamOptions,
  initializeStorageProvider,
  getStorageProvider,
} from "crunchycone-lib/services/storage";

/**
 * GET /storage/files/[...path]
 * Serves files from any crunchycone-lib storage provider
 * Only serves PUBLIC files - private files return 404
 *
 * Behavior:
 * - LocalStorage: Stream files using crunchycone-lib streaming
 * - Cloud Providers: Get signed URL and redirect (302)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  console.log("[Storage] === ROUTE HIT ===");
  console.log("[Storage] Request URL:", request.url);

  try {
    // Await params first
    const params = await context.params;
    console.log("[Storage] Raw params:", params);

    // Construct the file path from URL segments
    const filePath = params.segments.join("/");
    console.log("[Storage] File path constructed:", filePath);

    // Initialize storage provider if not already done
    console.log(`[Storage] Initializing storage provider...`);
    try {
      initializeStorageProvider();
      console.log(`[Storage] Provider initialized successfully`);
    } catch (error) {
      console.log(`[Storage] Provider already initialized or error:`, error);
    }

    const provider = getStorageProvider();
    const storageProviderType = process.env.CRUNCHYCONE_STORAGE_PROVIDER;
    console.log(`[Storage] Provider type: ${storageProviderType}`);
    console.log(`[Storage] Provider object:`, typeof provider, Object.keys(provider || {}));

    console.log(`[Storage] Checking file: ${filePath} (provider: ${storageProviderType})`);

    try {
      // Check if file exists
      const fileExists = await provider.fileExists(filePath);
      console.log(`[Storage] File exists: ${fileExists}`);

      if (!fileExists) {
        return new NextResponse("File not found", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // Check if file is public (LocalStorage always returns 'private' but provides publicUrl for public files)
      const visibility = await provider.getFileVisibility(filePath);
      console.log(`[Storage] Visibility: ${JSON.stringify(visibility)}`);

      // Check if file is public
      const isPublic = !!visibility.publicUrl;

      if (!isPublic) {
        // File is private - check if user is admin
        console.log(`[Storage] File is private, checking admin access...`);
        const session = await auth();

        if (!session || !(await hasRole(session.user.id, "admin"))) {
          console.log(`[Storage] No admin access, returning 404`);
          return new NextResponse("File not found", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          });
        }

        console.log(`[Storage] Admin access granted for private file`);
      } else {
        console.log(`[Storage] File is public, processing...`);
      }

      // Handle based on provider type
      if (storageProviderType === "localstorage") {
        // LocalStorage: Use crunchycone-lib streaming
        console.log(`[Storage] Using LocalStorage streaming`);
        return await streamLocalStorageFile(provider, filePath, request);
      } else {
        // Cloud Providers: Get signed URL and redirect
        const fileUrl = await provider.getFileUrl(filePath, 3600, { disposition: "inline" }); // 1 hour expiry, inline display
        return NextResponse.redirect(fileUrl, 302);
      }
    } catch {
      // Error handled silently
      return new NextResponse("File not found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }
  } catch {
    // Error handled silently
    return new NextResponse("Internal server error", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/**
 * Stream file from LocalStorage using crunchycone-lib
 */
async function streamLocalStorageFile(
  provider: StorageProvider,
  filePath: string,
  request: NextRequest
): Promise<NextResponse> {
  // Check if provider supports the new streaming interface
  const hasStreamSupport =
    provider && "getFileStream" in provider && typeof provider.getFileStream === "function";
  console.log(`[Storage] Stream support available: ${hasStreamSupport}`);

  if (hasStreamSupport) {
    try {
      // Parse range header for partial content requests
      const range = request.headers.get("range");
      let streamOptions: FileStreamOptions = {};

      if (range) {
        console.log(`[Storage] Range request: ${range}`);
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : undefined;
        streamOptions = { start, end };
      }

      // Get file stream from crunchycone-lib
      const streamResult = await provider.getFileStream!(filePath, streamOptions);
      console.log(`[Storage] Stream result:`, {
        contentType: streamResult.contentType,
        contentLength: streamResult.contentLength,
        isPartialContent: streamResult.isPartialContent,
        acceptsRanges: streamResult.acceptsRanges,
        streamType: streamResult.streamType,
      });

      // Build response headers
      const headers = new Headers({
        "Content-Type": streamResult.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });

      if (streamResult.contentLength) {
        headers.set("Content-Length", streamResult.contentLength.toString());
      }

      if (streamResult.lastModified) {
        headers.set("Last-Modified", streamResult.lastModified.toUTCString());
      }

      if (streamResult.acceptsRanges) {
        headers.set("Accept-Ranges", "bytes");
      }

      if (streamResult.etag) {
        headers.set("ETag", streamResult.etag);
      }

      // Handle partial content (206) vs full content (200)
      if (streamResult.isPartialContent && streamResult.range) {
        headers.set(
          "Content-Range",
          `bytes ${streamResult.range.start}-${streamResult.range.end}/${streamResult.range.total}`
        );
        console.log(
          `[Storage] Serving partial content: ${streamResult.range.start}-${streamResult.range.end}/${streamResult.range.total}`
        );
        return new NextResponse(streamResult.stream as ReadableStream, {
          status: 206,
          headers: Object.fromEntries(headers.entries()),
        });
      } else {
        console.log(`[Storage] Serving full content`);
        return new NextResponse(streamResult.stream as ReadableStream, {
          status: 200,
          headers: Object.fromEntries(headers.entries()),
        });
      }
    } catch (streamError) {
      console.error(`[Storage] Streaming failed:`, streamError);
      throw streamError;
    }
  } else {
    console.log(`[Storage] No stream support, falling back to file serving with range support`);
    // For localstorage without stream support, we need to serve the file directly
    // with proper range request support for video playback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mime = require("mime-types");

    const fullPath = path.join(process.env.CRUNCHYCONE_LOCALSTORAGE_PATH!, filePath);

    // Get file stats
    const stats = fs.statSync(fullPath);
    const fileSize = stats.size;
    const contentType = mime.lookup(filePath) || "application/octet-stream";

    // Parse range header
    const range = request.headers.get("range");
    const userAgent = request.headers.get("user-agent") || "";

    console.log(
      `[Storage] File request - Size: ${fileSize}, Type: ${contentType}, UA: ${userAgent.substring(0, 50)}...`
    );

    if (range) {
      console.log(`[Storage] Processing range request: ${range}`);
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      // Create read stream with range
      const readStream = fs.createReadStream(fullPath, { start, end });

      return new NextResponse(readStream, {
        status: 206, // Partial Content
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": contentType,
          "Content-Disposition":
            contentType.startsWith("video/") || contentType.startsWith("image/")
              ? "inline"
              : "attachment",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } else {
      // Serve full file
      const fileBuffer = fs.readFileSync(fullPath);

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
          "Content-Disposition":
            contentType.startsWith("video/") || contentType.startsWith("image/")
              ? "inline"
              : "attachment",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }
}

/**
 * HEAD /storage/files/[...path]
 * Returns file metadata without the file content
 */
export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ segments: string[] }> }
) {
  try {
    // Initialize storage provider if not already done
    try {
      initializeStorageProvider();
    } catch {
      // Provider might already be initialized
    }

    const provider = getStorageProvider();
    const params = await context.params;
    const filePath = params.segments.join("/");

    // Check if file exists and is public
    const fileExists = await provider.fileExists(filePath);
    if (!fileExists) {
      return new NextResponse(null, { status: 404 });
    }

    const visibility = await provider.getFileVisibility(filePath);
    const isPublic = !!visibility.publicUrl;

    if (!isPublic) {
      // File is private - check if user is admin
      const session = await auth();
      if (!session || !(await hasRole(session.user.id, "admin"))) {
        return new NextResponse(null, { status: 404 });
      }
    }

    // Try to get basic metadata
    try {
      // Use streaming interface to get metadata without content
      const hasStreamSupport = "getFileStream" in provider;
      if (hasStreamSupport) {
        const streamResult = await provider.getFileStream!(filePath, {
          includeMetadata: true,
        });

        // Close the stream immediately since we only want headers
        if (streamResult.cleanup) {
          await streamResult.cleanup();
        }

        const headers = new Headers({
          "Content-Type": streamResult.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        });

        if (streamResult.contentLength) {
          headers.set("Content-Length", streamResult.contentLength.toString());
        }

        if (streamResult.lastModified) {
          headers.set("Last-Modified", streamResult.lastModified.toUTCString());
        }

        if (streamResult.acceptsRanges) {
          headers.set("Accept-Ranges", "bytes");
        }

        return new NextResponse(null, {
          status: 200,
          headers: Object.fromEntries(headers.entries()),
        });
      } else {
        // Basic response for providers without streaming support
        const contentType = lookup(filePath) || "application/octet-stream";
        return new NextResponse(null, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
    } catch {
      // Fallback to basic response
      const contentType = lookup(filePath) || "application/octet-stream";
      return new NextResponse(null, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch {
    // Error handled silently
    return new NextResponse(null, { status: 500 });
  }
}
