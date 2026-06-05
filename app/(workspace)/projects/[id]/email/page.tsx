import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectEmailRedirect({ params }: PageProps) {
  const { id: projectId } = await params;
  redirect(`/reports/email?tab=email-report&project=${projectId}`);
}
