/**
 * Headline / profile text fixtures for classifier + integration tests.
 * Ids are stable for rule preview API and tests.
 */

export type HeadlineFixture = {
  id: string;
  headline: string;
  postSnippet?: string;
  linkedinUrl?: string;
};

export const HEADLINE_FIXTURES: HeadlineFixture[] = [
  {
    id: "long-cto-mashup",
    headline:
      "CTO | Agentic AI & Search Leader | MACH Alliance Exec Board Member & Co-Founder MACH AI Exchange | OnCon Icon Global 50",
  },
  { id: "founder-tinystudio", headline: "Founder at TinyStudio" },
  { id: "solo-founder-ai", headline: "Solo founder building AI tools" },
  {
    id: "fractional-cto",
    headline: "Fractional CTO | Advisor | ex-Google",
  },
  {
    id: "recruiter-startups",
    headline: "Recruiter helping startups hire engineers",
  },
  { id: "open-to-work", headline: "Open to work | Engineering Manager" },
  { id: "investor-vc", headline: "Investor at [Venture Firm Name]" },
  { id: "angel-ex-vp", headline: "Angel investor | former VP Product" },
  { id: "vp-eng-acme", headline: "VP Engineering at Acme" },
  {
    id: "dir-platform-retail",
    headline: "Director of Platform Engineering, Global RetailCo",
  },
  { id: "staff-ai-infra", headline: "Staff Engineer working on AI infra" },
  {
    id: "security-ai-gov",
    headline: "Security leader focused on AI governance",
  },
  {
    id: "founder-ceo-competitor",
    headline: "Founder & CEO at CompetitorName",
  },
  {
    id: "consultant-ai",
    headline: "Consultant helping companies adopt AI",
  },
  { id: "student-stanford", headline: "Student at Stanford" },
  { id: "building-new", headline: "Building something new" },
  { id: "ex-bigtech-advisor", headline: "ex-Meta, ex-Google, advisor" },
  { id: "talent-partner-vc", headline: "Talent Partner at [Venture Firm Name]" },
  {
    id: "mach-board",
    headline: "MACH Alliance Executive Board Member",
  },
  {
    id: "ai-agent-security-founder",
    headline: "AI Agent Security Founder",
  },
];

export function getHeadlineFixtureById(id: string): HeadlineFixture | undefined {
  return HEADLINE_FIXTURES.find((f) => f.id === id);
}
