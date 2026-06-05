import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Prospect intelligence lives under Email reports; keep old URLs working. */
export default async function ProjectProspectsRedirect({ params }: PageProps) {
  const { id: projectId } = await params;
  redirect(`/reports/email?tab=prospect-intelligence&project=${projectId}`);
}
