import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Campaigns live under Email reports; keep old URLs working. */
export default async function ProjectEmailCampaignsRedirect({ params }: PageProps) {
  const { id: projectId } = await params;
  redirect(`/reports/email?tab=campaigns&project=${projectId}`);
}
