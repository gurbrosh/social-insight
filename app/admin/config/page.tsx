import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import ConfigManager from "@/components/admin/ConfigManager";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const isUserAdmin = await isAdmin(session.user.id);
  if (!isUserAdmin) {
    redirect("/admin");
  }

  return (
    <div className="container mx-auto py-6">
      <ConfigManager />
    </div>
  );
}
