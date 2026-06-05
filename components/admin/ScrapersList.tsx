"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Settings,
  Play,
  Pause,
  Trash2,
  MoreHorizontal,
  Database,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { toast } from "@/hooks/use-toast";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { KeywordSelector } from "./KeywordSelector";

interface Scraper {
  id: string;
  name: string;
  descriptive_name?: string | null;
  actor_id: string;
  readme_url?: string;
  platform: string;
  config_json: string;
  is_active: boolean;
  save_to_db: boolean;
  created_at: string;
  updated_at: string;
  _count?: {
    jobs: number;
  };
}

export function ScrapersList() {
  const [scrapers, setScrapers] = useState<Scraper[]>([]);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [testingScraper, setTestingScraper] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    scraper: Scraper | null;
  }>({ open: false, scraper: null });
  const [testDialog, setTestDialog] = useState<{
    open: boolean;
    scraper: Scraper | null;
  }>({ open: false, scraper: null });
  const [testKeywords, setTestKeywords] = useState<string[]>([]);
  const [saveTestResults, setSaveTestResults] = useState(false);

  const fetchScrapers = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/scrapers");
      if (!response.ok) throw new Error("Failed to fetch scrapers");

      const data = await response.json();
      setScrapers(data.scrapers || []);
    } catch (error) {
      console.error("Error fetching scrapers:", error);
      toast({
        title: "Error",
        description: "Failed to load scrapers. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScrapers();
  }, []);

  const toggleScraperStatus = async (scraperId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/admin/scrapers/${scraperId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_active: !currentStatus,
        }),
      });

      if (!response.ok) throw new Error("Failed to update scraper");

      toast({
        title: "Scraper Updated",
        description: `Scraper has been ${!currentStatus ? "activated" : "deactivated"}.`,
      });

      fetchScrapers();
    } catch (error) {
      console.error("Error updating scraper:", error);
      toast({
        title: "Error",
        description: "Failed to update scraper. Please try again.",
        variant: "destructive",
      });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const openTestDialog = (scraper: Scraper) => {
    setTestDialog({ open: true, scraper });
    setTestKeywords([]);
    setSaveTestResults(false);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const testScraper = async () => {
    if (!testDialog.scraper) return;

    if (testKeywords.length === 0) {
      toast({
        title: "No Keywords Selected",
        description: "Please select at least one keyword to test with.",
        variant: "destructive",
      });
      return;
    }

    setTestingScraper(testDialog.scraper.id);

    try {
      const response = await fetch(`/api/admin/scrapers/${testDialog.scraper.id}/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          testInput: {
            keywords: testKeywords,
          },
          saveTestResults: saveTestResults,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Test failed");
      }

      const saveMessage =
        saveTestResults && data.success ? " Test results have been saved to the database." : "";
      toast({
        title: "Test Completed",
        description: data.success
          ? `Success! Found ${data.totalItems || 0} items.${saveMessage}`
          : `Test failed: ${data.error}`,
        variant: data.success ? "default" : "destructive",
      });

      setTestDialog({ open: false, scraper: null });
    } catch (error) {
      console.error("Error testing scraper:", error);
      toast({
        title: "Test Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred.",
        variant: "destructive",
      });
    } finally {
      setTestingScraper(null);
    }
  };

  const deleteScraper = async () => {
    if (!deleteDialog.scraper) return;

    try {
      const response = await fetch(`/api/admin/scrapers/${deleteDialog.scraper.id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete scraper");

      toast({
        title: "Scraper Deleted",
        description: "The scraper has been deleted successfully.",
      });

      fetchScrapers();
    } catch (error) {
      console.error("Error deleting scraper:", error);
      toast({
        title: "Error",
        description: "Failed to delete scraper. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteDialog({ open: false, scraper: null });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scrapers</CardTitle>
          <CardDescription>Loading scrapers...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (scrapers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scrapers</CardTitle>
          <CardDescription>No scrapers configured yet</CardDescription>
        </CardHeader>
        <CardContent className="text-center py-12">
          <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Scrapers Yet</h3>
          <p className="text-muted-foreground mb-4">
            Configure your first scraper to start collecting social media data.
          </p>
          <Button asChild>
            <Link href="/admin/scrapers/new">
              <Settings className="mr-2 h-4 w-4" />
              Add Your First Scraper
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Configured Scrapers</CardTitle>
          <CardDescription>Manage your Apify scrapers and their configurations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {scrapers.map((scraper) => (
              <div
                key={scraper.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{scraper.name}</h3>
                    {scraper.descriptive_name && scraper.descriptive_name.trim().length > 0 && (
                      <Badge variant="secondary">{scraper.descriptive_name}</Badge>
                    )}
                    <Badge variant={scraper.is_active ? "default" : "secondary"}>
                      {scraper.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      {scraper.save_to_db ? (
                        <>
                          <Database className="h-3 w-3" />
                          Save to DB
                        </>
                      ) : (
                        <>
                          <ExternalLink className="h-3 w-3" />
                          Downstream
                        </>
                      )}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Actor ID: {scraper.actor_id}</p>
                  <p className="text-sm text-muted-foreground">Platform: {scraper.platform}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(scraper.created_at).toLocaleDateString()}
                    {scraper._count?.jobs && <span> • {scraper._count.jobs} jobs</span>}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleScraperStatus(scraper.id, scraper.is_active)}
                  >
                    {scraper.is_active ? (
                      <>
                        <Pause className="mr-2 h-4 w-4" />
                        Deactivate
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Activate
                      </>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/scrapers/${scraper.id}/edit`}>
                          <Settings className="mr-2 h-4 w-4" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteDialog({ open: true, scraper })}
                        className="text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, scraper: deleteDialog.scraper })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scraper</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteDialog.scraper?.name}&quot;? This action
              cannot be undone and will affect any ongoing jobs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteScraper} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
