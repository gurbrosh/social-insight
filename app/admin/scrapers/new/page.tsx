import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { CreateScraperForm } from "@/components/admin/CreateScraperForm";

export const dynamic = "force-dynamic";

export default async function NewScraperPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    redirect("/");
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Add New Scraper</h1>
          <p className="text-muted-foreground">
            Configure a new Apify scraper for social media monitoring
          </p>
        </div>

        <CreateScraperForm />
      </div>
    </div>
  );
}
