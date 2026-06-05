import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing URL parameter", { status: 400 });
  }

  try {
    // Validate that it's a valid image URL from allowed domains
    const imageUrl = new URL(url);
    const allowedDomains = [
      "lh3.googleusercontent.com",
      "avatars.githubusercontent.com",
      "i.pravatar.cc",
      "images.unsplash.com",
      "via.placeholder.com",
    ];

    if (!allowedDomains.includes(imageUrl.hostname)) {
      return new NextResponse("Domain not allowed", { status: 403 });
    }

    // Fetch the image
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Avatar Proxy)",
      },
    });

    if (!response.ok) {
      return new NextResponse("Failed to fetch image", { status: response.status });
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) {
      return new NextResponse("Not an image", { status: 400 });
    }

    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("Avatar proxy error:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
