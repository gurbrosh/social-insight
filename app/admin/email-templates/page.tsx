import { requireRole } from "@/lib/auth/permissions";
import { EmailTemplatesView } from "@/components/admin/EmailTemplatesView";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Email Templates - Admin Dashboard",
  description: "Manage and preview email templates",
};

export default async function EmailTemplatesPage() {
  await requireRole("admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Email Templates</h1>
        <p className="text-muted-foreground">
          Preview and manage your application&apos;s email templates
        </p>
      </div>

      <EmailTemplatesView />
    </div>
  );
}
