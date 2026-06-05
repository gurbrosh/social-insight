import { redirect } from "next/navigation";
import { checkAdminExists } from "@/app/actions/admin";
import { SetupAdminForm } from "./SetupAdminForm";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export default async function SetupAdminPage() {
  // Check if admin already exists
  const adminExists = await checkAdminExists();

  if (adminExists) {
    // Redirect to home if admin already exists
    redirect("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SetupAdminForm />
    </div>
  );
}
