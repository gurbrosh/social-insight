import { EnvironmentVariablesDisplay } from "@/components/admin/EnvironmentVariablesDisplay";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

export default function AdminEnvironmentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Environment Variables</h1>
        <p className="text-muted-foreground">View environment variables</p>
      </div>

      <EnvironmentVariablesDisplay />
    </div>
  );
}
