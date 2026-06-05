import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { EditProjectForm } from "@/components/projects/EditProjectForm";
import { ThemeManager } from "@/components/projects/ThemeManager";
import { ResponseObjectivesManager } from "@/components/projects/ResponseObjectivesManager";
import { EngagementThresholdsForm } from "@/components/projects/EngagementThresholdsForm";
import { MyProductSection } from "@/components/projects/MyProductSection";
import { parseMyProductSummaryJson } from "@/lib/my-product/summary-types";

export const dynamic = "force-dynamic";

interface EditProjectPageProps {
  params: Promise<{
    id: string;
  }>;
}

async function EditProjectContent({ projectId }: { projectId: string }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      user_id: session.user.id,
      deleted_at: null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      monitoring_focus: true,
      linkedin_engagement_threshold: true,
      facebook_engagement_threshold: true,
      twitter_engagement_threshold: true,
      require_keywords_with_brands: true,
      analysis_profile: true,
      analysis_sample_post_limit: true,
      keywords: {
        where: { deleted_at: null },
      },
      brands: {
        where: { deleted_at: null },
        select: {
          brand_name: true,
          brand_id: true,
        },
      },
      profiles: {
        where: { deleted_at: null },
      },
      my_product_name: true,
      my_product_focus_text: true,
      my_product_reference_urls: true,
      my_product_summary_json: true,
      my_product_summary_updated_at: true,
      myProductDocuments: {
        where: { deleted_at: null },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          original_filename: true,
          byte_size: true,
          content_type: true,
          created_at: true,
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Edit" },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/projects">
                <ArrowLeft className="mr-2 h-4 w-4" />
                All Projects
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${projectId}`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Project
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/reports/email?tab=prospect-intelligence&project=${projectId}`}>
                PI routing (automation)
              </Link>
            </Button>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Project</h1>
            <p className="text-muted-foreground">Update your project settings and keywords</p>
          </div>
        </div>
      </div>

      {/* Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle>Project Details</CardTitle>
          <CardDescription>Update your project information and keywords</CardDescription>
        </CardHeader>
        <CardContent>
          <EditProjectForm
            projectId={projectId}
            initialData={{
              name: project.name,
              description: project.description || "",
              monitoring_focus: (project as any).monitoring_focus || "",
              keywords: project.keywords.map((k) => k.keyword),
              brands: project.brands.map((b) => ({
                id: b.brand_id || "",
                brand_name: b.brand_name,
                company_name: b.brand_name, // Fallback if we don't have company name
              })),
              profiles: project.profiles.map((p) => ({
                platform: (p.platform || "").toLowerCase(),
                name: p.name,
                url: p.url,
                type: p.type as "person" | "company" | "channel",
                is_selected: p.is_selected,
              })),
              require_keywords_with_brands: project.require_keywords_with_brands ?? false,
              analysis_profile: project.analysis_profile === "minimal" ? "minimal" : "full",
              analysis_sample_post_limit: project.analysis_sample_post_limit,
            }}
          />
        </CardContent>
      </Card>

      <MyProductSection
        projectId={projectId}
        initialProductName={project.my_product_name ?? ""}
        initialFocus={project.my_product_focus_text ?? ""}
        initialUrls={(() => {
          const raw = project.my_product_reference_urls;
          if (!raw) return [];
          try {
            const p = JSON.parse(raw) as unknown;
            return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
          } catch {
            return [];
          }
        })()}
        initialDocuments={project.myProductDocuments}
        initialSummary={parseMyProductSummaryJson(project.my_product_summary_json)}
        initialSummaryUpdatedAt={project.my_product_summary_updated_at?.toISOString() ?? null}
      />

      {/* Conversation Filter Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Conversation Filter</CardTitle>
          <CardDescription>
            For projects that have high social media engagement, use filters to eliminate shorter
            conversations that have fewer likes/ comments/ shares
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EngagementThresholdsForm
            projectId={projectId}
            initialThresholds={{
              linkedin: project.linkedin_engagement_threshold,
              facebook: project.facebook_engagement_threshold,
              twitter: project.twitter_engagement_threshold,
            }}
          />
        </CardContent>
      </Card>

      {/* Theme Management */}
      <ThemeManager projectId={projectId} />

      <ResponseObjectivesManager projectId={projectId} />

      {/* Submit Button - at bottom of page */}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}`}>Cancel</Link>
        </Button>
        <Button type="submit" form="edit-project-form">
          Update Project
        </Button>
      </div>
    </div>
  );
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const resolvedParams = await params;

  return (
    <div className="container mx-auto py-6 px-4">
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              <div>
                <div className="h-8 w-48 bg-muted animate-pulse rounded mb-2" />
                <div className="h-4 w-64 bg-muted animate-pulse rounded" />
              </div>
            </div>
            <div className="h-96 bg-muted animate-pulse rounded-lg" />
          </div>
        }
      >
        <EditProjectContent projectId={resolvedParams.id} />
      </Suspense>
    </div>
  );
}
