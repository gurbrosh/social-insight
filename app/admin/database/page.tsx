import { DatabaseViewerPanel } from "@/components/admin/DatabaseViewerPanel";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

export default async function DatabasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Database Viewer</h1>
        <p className="text-muted-foreground">
          Browse and inspect database tables and their contents
        </p>
      </div>

      <DatabaseViewerPanel />
    </div>
  );
}
