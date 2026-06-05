import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { CreateScraperForm } from "@/components/admin/CreateScraperForm";

export const dynamic = "force-dynamic";

interface EditScraperPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EditScraperPage({ params }: EditScraperPageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    redirect("/");
  }

  // Await params in Next.js 15
  const { id } = await params;

  // Fetch the scraper
  const scraper = await prisma.scraper.findUnique({
    where: {
      id: id,
      deleted_at: null,
    },
  });

  if (!scraper) {
    redirect("/admin/scrapers");
  }

  return (
    <div className="container mx-auto py-10">
      <CreateScraperForm scraper={scraper} />
    </div>
  );
}
