import { AuthConfigForm } from "@/components/admin/AuthConfigForm";
import { EmailConfigForm } from "@/components/admin/EmailConfigForm";
import { StorageConfigForm } from "@/components/admin/StorageConfigForm";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage application settings and configuration</p>
      </div>

      {/* Authentication Configuration Form */}
      <AuthConfigForm />

      {/* Email Configuration Form */}
      <EmailConfigForm />

      {/* Storage Configuration Form */}
      <StorageConfigForm />
    </div>
  );
}
