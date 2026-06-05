import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppWorkspaceShell } from "@/components/layout/AppWorkspaceShell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const projects = await prisma.project.findMany({
    where: {
      user_id: session.user.id,
      deleted_at: null,
    },
    orderBy: { created_at: "desc" },
    select: { id: true, name: true },
  });

  return <AppWorkspaceShell projects={projects}>{children}</AppWorkspaceShell>;
}
