import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CreateProjectForm } from "@/components/projects/CreateProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Create New Project</h1>
        <p className="text-muted-foreground">
          Set up a new social listening project with keywords to monitor
        </p>
      </div>

      <CreateProjectForm />
    </div>
  );
}
