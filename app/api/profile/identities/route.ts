import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ulid as generateUlid } from "ulid";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const identities = await prisma.userPlatformIdentity.findMany({
    where: { user_id: session.user.id, deleted_at: null },
    orderBy: { platform: "asc" },
  });
  return NextResponse.json(identities);
}

const upsertSchema = z.object({
  platform: z.string().min(1),
  identity: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const data = upsertSchema.parse(body);

  // Upsert by unique (user_id, platform, identity)
  await prisma.userPlatformIdentity.upsert({
    where: {
      user_id_platform_identity: {
        user_id: session.user.id,
        platform: data.platform,
        identity: data.identity,
      },
    } as any,
    update: { deleted_at: null },
    create: {
      id: generateUlid(),
      user_id: session.user.id,
      platform: data.platform,
      identity: data.identity,
      verified: false,
    },
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const identity = searchParams.get("identity");
  if (!platform || !identity)
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  await prisma.userPlatformIdentity.updateMany({
    where: { user_id: session.user.id, platform, identity, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  return NextResponse.json({ success: true });
}
