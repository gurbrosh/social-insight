import assert from "node:assert/strict";
import { test } from "node:test";
import { composeSafeProfessionalReference } from "./safe-reference-compose";
import {
  headlineEmployerLooksDescriptorOrCompoundRole,
  headlineEmployerLooksEventOrMarketing,
  headlineTitleLooksSloganLike,
} from "./employment-guardrails";

test("composeSafeProfessionalReference: domain-specific headlines", () => {
  const cases: Array<{ headline: string; expected: string }> = [
    {
      headline:
        "AI Content Creator | Teaching creators how to use AI for visuals, video & storytelling",
      expected: "your AI content and creator education work",
    },
    {
      headline: "Cyber Defense Engineer @ [Company] | eCIR | Security+",
      expected: "your cyber defense engineering work",
    },
    {
      headline:
        "AI Automation Specialist | Helping businesses scale | Custom AI agents for sales & support",
      expected: "your AI automation consulting work",
    },
    {
      headline:
        "Lecturer @ [University] | Teaching | Data Scientist | Bioinformatician | Mentor",
      expected: "your data science and bioinformatics education work",
    },
    {
      headline:
        "Founder @[Entity] | Senior AI Engineer | Building Robust Production AI Agents",
      expected: "your AI agents founder and engineering work",
    },
    {
      headline: "Fractional AI Sales Leader | GTM for B2B SaaS",
      expected: "your AI sales leadership work",
    },
    {
      headline: "Student || [Campus] || Passionate about cyber security",
      expected: "your cybersecurity studies",
    },
    {
      headline: "Protecting Sensitive Data through Securing APIs @ [Security Vendor]",
      expected: "your API security and data protection work",
    },
    {
      headline: "Principal AI Architect | Generative AI, Agentic Systems, MCP, RAG",
      expected: "your agentic AI architecture work",
    },
    {
      headline:
        "Engineering Leader & Security Architect | Enterprise Identity + GenAI Enablement",
      expected: "your identity security and GenAI architecture leadership",
    },
    {
      headline: "Helping Enterprises Secure Identities at Scale",
      expected: "your identity security work",
    },
    {
      headline: "Sr. Platform Engineer | AWS | Azure | GCP | Terraform | Kubernetes",
      expected: "your cloud platform engineering work",
    },
    {
      headline:
        "Cyber Security | Bestselling Author | AI Advisory Board Member | 2M+ trained globally",
      expected: "your cybersecurity education and advisory work",
    },
    {
      headline: "Senior Director of Security Engineering at [Industry Org]",
      expected: "your security engineering leadership",
    },
    {
      headline:
        "Tech Lead | AI Platforms, Distributed Systems & Product Engineering | [Company]",
      expected: "your AI platform and distributed systems leadership",
    },
    {
      headline: "Founder & CEO, [Entity] AI Technologies | Building AI systems",
      expected: "your AI systems founder perspective",
    },
    {
      headline: "Security Engineer @ [Vendor] | SASE | SOC | EDR/XDR | PAM | DLP",
      expected: "your SASE and security engineering work",
    },
    {
      headline: "Co-Founder & CTO at [Entity] | AI cybersecurity",
      expected: "your AI cybersecurity founder and engineering work",
    },
    {
      headline: "Founding CEO of [Entity] with EMBA-backed expertise in corporate turnarounds_",
      expected: "your founder and turnaround leadership",
    },
    {
      headline:
        "Results-Driven Logistics Operations Leader | Scaling Asset-Based Fleets, Dispatch & TMS",
      expected: "your logistics operations leadership",
    },
    {
      headline:
        "Career & Leadership Strategist | Go-To-Market Partner | revenue-driving professionals",
      expected: "your career and go-to-market strategy work",
    },
    {
      headline: "Supplier Management Manager at [Automotive Employer]",
      expected: "your supplier management work",
    },
    {
      headline: "VP R&D at [Entity]",
      expected: "your R&D and engineering leadership",
    },
    {
      headline: "Security Engineer at [Company] | #RSAC #DEFCON #BSIDES Speaker | Blogger",
      expected: "your security engineering and security community work",
    },
    {
      headline: "Owner/CoFounder @ Cyber Security Tribe",
      expected: "your cybersecurity founder and community work",
    },
    {
      headline: "Head of Security at [Employer]",
      expected: "your security leadership work",
    },
    {
      headline:
        "Founder @ [Labs] | Manage human cyber-risk... AI-driven Vishing, Smishing, Quishing",
      expected: "your AI-driven security awareness founder work",
    },
    {
      headline:
        "Senior Developer & Team Leader - BI dev, Statistics, GL Interface & Reports at [Employer]",
      expected: "your BI development and engineering leadership",
    },
    {
      headline: "Founder & Lead Developer @ [Entity] | AI Automation Engineer",
      expected: "your AI automation founder and engineering work",
    },
  ];

  for (const { headline, expected } of cases) {
    const ref = composeSafeProfessionalReference({
      headline,
      roleCategories: ["unknown"],
      functionTags: ["unknown"],
    });
    assert.equal(ref, expected, headline.slice(0, 60));
  }
});

test("headlineHasExplicitFounderEvidence: founding CEO", async () => {
  const { headlineHasExplicitFounderEvidence } = await import("./classify.ts");
  assert.equal(
    headlineHasExplicitFounderEvidence(
      "Founding CEO of [Entity] with EMBA-backed expertise in corporate turnarounds"
    ),
    true
  );
});

test("headline employment guardrails: descriptor and remote-work employers", () => {
  assert.equal(
    headlineEmployerLooksDescriptorOrCompoundRole(
      "Remote Work & Cybersecurity Specialist",
      "Python Engineer"
    ),
    true
  );
  assert.equal(headlineEmployerLooksDescriptorOrCompoundRole("[Employer Inc]", "Python Engineer"), false);
});

test("headline employment guardrails: slogan and event employers", () => {
  assert.equal(
    headlineTitleLooksSloganLike("Protecting Sensitive Data through Securing APIs"),
    true
  );
  assert.equal(headlineTitleLooksSloganLike("Cyber Defense Engineer"), false);
  assert.equal(headlineEmployerLooksEventOrMarketing("ATxSummit 2026"), true);
  assert.equal(headlineEmployerLooksEventOrMarketing("[Security Vendor]"), false);
});
