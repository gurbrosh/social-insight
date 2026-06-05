import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Settings, Play } from "lucide-react";
import Link from "next/link";
import { ScrapersList } from "@/components/admin/ScrapersList";
import { SearchSourceTasksList } from "@/components/admin/SearchSourceTasksList";
import { SourceMentionAdminPanel } from "@/components/admin/SourceMentionAdminPanel";

export const dynamic = "force-dynamic";

async function ScrapersPageContent() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userIsAdmin = await isAdmin(session.user.id);
  if (!userIsAdmin) {
    redirect("/");
  }

  // Fetch scraper counts
  const totalScrapers = await prisma.scraper.count({
    where: { deleted_at: null },
  });

  const activeScrapers = await prisma.scraper.count({
    where: {
      deleted_at: null,
      is_active: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Search Sources</h1>
        <p className="text-muted-foreground">
          Configure Apify scrapers and custom search tasks (e.g. LLM, scripted sources)
        </p>
      </div>

      <SourceMentionAdminPanel />

      <Tabs defaultValue="scrapers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scrapers">Apify Scrapers</TabsTrigger>
          <TabsTrigger value="tasks">Custom Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="scrapers" className="space-y-6">
          <div className="flex justify-end">
            <Button asChild>
              <Link href="/admin/scrapers/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Scraper
              </Link>
            </Button>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Scrapers</CardTitle>
                <Settings className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalScrapers}</div>
                <p className="text-xs text-muted-foreground">All configured scrapers</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Scrapers</CardTitle>
                <Play className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{activeScrapers}</div>
                <p className="text-xs text-muted-foreground">Currently enabled</p>
              </CardContent>
            </Card>
          </div>
          <ScrapersList />
        </TabsContent>

        <TabsContent value="tasks" className="space-y-6">
          <SearchSourceTasksList />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ScrapersPage() {
  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="h-8 w-48 bg-muted animate-pulse rounded" />
                <div className="h-4 w-96 bg-muted animate-pulse rounded mt-2" />
              </div>
              <div className="h-10 w-32 bg-muted animate-pulse rounded" />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
            <div className="h-64 bg-muted animate-pulse rounded-lg" />
          </div>
        }
      >
        <ScrapersPageContent />
      </Suspense>
    </div>
  );
}
