import { MediaUploader } from "@/components/admin/MediaUploader";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

export default function AdminMediaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Media Manager</h1>
        <p className="text-muted-foreground">Upload and manage your media files</p>
      </div>

      <MediaUploader />
    </div>
  );
}
