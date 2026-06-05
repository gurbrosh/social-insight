# Blog / News Analysis: Table Schema and OpenAI Instructions

This document defines the database schema and OpenAI prompt instructions for the blog/news analysis pipeline (URL starting point + time limit, no Apify; OpenAI parses and summarizes each item and fills structured dimensions).

---

## 1. Run and pipeline inputs

- **Inputs per run:** A set of **starting URLs** (blog or newsroom roots) and a **time limit**: "no items before this date" (only analyze items with `article_date >= no_items_before_date`).
- **Output:** A summarized list of news/blog items, each with a **summary** and the **structured dimensions** below. Stored in the new table(s); duplicate articles (same `project_id` + `article_url`) are not re-inserted.

---

## 2. Table schema (Prisma)

Below is additive to your existing `schema.prisma`: new enums and two new models. IDs follow your convention (ULID string, middleware-generated). Soft deletes (`deleted_at`) and timestamps are included.

### 2.1 Enums

```prisma
// --- Audience ---
enum ContentPersona {
  DEVELOPER_ENGINEER
  CTO_VP_ENGINEERING
  CISO_SECURITY_LEADER
  BUSINESS_BUYER
  END_USER_CUSTOMER
  INVESTOR_ANALYST
  PARTNER_ECOSYSTEM
  GENERAL_PUBLIC_PRESS
}

enum SeniorityLevel {
  IC
  MANAGER
  EXECUTIVE
  MIXED
}

enum AudienceDomain {
  TECHNICAL
  BUSINESS
  COMPLIANCE_LEGAL
  MIXED
}

enum AudienceTargeting {
  EXPLICITLY_TARGETED
  BROAD_MULTI_PERSONA
}

// --- Offering context ---
enum OfferingContentType {
  NEW_PRODUCT
  NEW_FEATURE
  EXISTING_PRODUCT_ENHANCEMENT
  REPOSITIONING_EXISTING_CAPABILITY
  PACKAGING_PRICING_CHANGE
  NO_PRODUCT_MENTIONED
}

enum LifecycleStage {
  ANNOUNCEMENT
  EARLY_ACCESS_BETA
  GA_LAUNCH
  ITERATION_IMPROVEMENT
  DEPRECATION_SUNSET
}

// --- Primary intent ---
enum PrimaryIntent {
  PRODUCT_FEATURE_ANNOUNCEMENT
  COMPETITIVE_DIFFERENTIATION
  CUSTOMER_PARTNER_ANNOUNCEMENT
  TECHNICAL_EDUCATION_THOUGHT_LEADERSHIP
  TRUST_RISK_REDUCTION
  MARKET_POSITIONING_NARRATIVE_SHAPING
  EVENT_PROMOTION_OR_RECAP
  BRAND_CREDIBILITY
  VISION_ROADMAP_SIGNALING
}

enum SecondaryIntent {
  RECRUITING
  INVESTOR_SIGNALING
  SEO_DISCOVERABILITY
  COMMUNITY_BUILDING
}

// --- Evidence & credibility ---
enum EvidenceType {
  CLAIMS_ONLY
  METRICS_NUMBERS
  CUSTOMER_QUOTES
  LOGOS_NAMED_BRANDS
  BENCHMARKS_COMPARISONS
  THIRD_PARTY_VALIDATION
}

enum EvidenceStrength {
  WEAK
  MODERATE
  STRONG
}

// --- Depth & specificity ---
enum SpecificityLevel {
  HIGH_LEVEL_CONCEPTUAL
  SEMI_TECHNICAL
  DEEP_TECHNICAL
  OPERATIONAL_TACTICAL
}

enum ActionabilityLevel {
  INFORMATIONAL_ONLY
  EXPLAINS_HOW
  INVITES_ACTION
}

// --- Competitive signal ---
enum CompetitivePosture {
  EXPLICIT_COMPETITOR_COMPARISON
  IMPLICIT_DIFFERENTIATION
  CATEGORY_DEFINITION_REFRAMING
  NO_COMPETITIVE_SIGNAL
}

enum CompetitiveDirection {
  OFFENSIVE
  DEFENSIVE
}

// --- Sensitivity & risk ---
enum SensitivityLevel {
  LOW
  MEDIUM
  HIGH
}

enum SensitivityTone {
  REASSURING
  DEFENSIVE
  CONFIDENT
  TRANSPARENT_POST_INCIDENT
}

// --- Temporal ---
enum TimingNature {
  PROACTIVE
  REACTIVE
  SEASONAL_CYCLICAL
}

enum UrgencyLevel {
  IMMEDIATE
  NEAR_TERM
  LONG_TERM
}

// --- Strategic ---
enum ConfidencePosture {
  EXPLORATORY
  ASSERTIVE
  DEFENSIVE
  EVANGELICAL
}

// --- Meta (optional) ---
enum ContentArchetype {
  ANNOUNCEMENT
  PROOF_POINT
  NARRATIVE_SHAPING
  DAMAGE_CONTROL
  EVANGELISM
}
```

### 2.2 Run tracking model (optional but recommended)

Tracks each analysis run: which URL was scraped, time limit, when it ran, and how many items were found.

```prisma
model BlogAnalysisRun {
  id                    String    @id @default("")
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt
  deleted_at            DateTime?

  project_id            String
  source_url            String    // Starting URL (blog/newsroom root)
  no_items_before_date  DateTime  // Only items on or after this date
  run_at                DateTime  @default(now())
  status                BlogAnalysisRunStatus @default(PENDING)
  items_found_count     Int       @default(0)
  error_message         String?   // If status = FAILED

  project               Project   @relation(fields: [project_id], references: [id])
  analyses              BlogNewsAnalysis[]

  @@index([project_id])
  @@index([run_at])
  @@index([deleted_at])
}

enum BlogAnalysisRunStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}
```

### 2.3 Main analysis model

One row per analyzed blog/news item. Deduplication: one row per `(project_id, article_url)`; re-runs only insert when that pair does not exist and `article_date >= no_items_before_date`.

```prisma
model BlogNewsAnalysis {
  id              String    @id @default("")
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt
  deleted_at      DateTime?

  project_id      String
  analysis_run_id String?   // Optional link to the run that created this
  source_url      String    // Starting URL (blog/newsroom) this item came from
  article_url     String    // Canonical URL of this article
  article_title   String?
  article_date    DateTime? // Extracted publication date (for time filter and display)
  summary         String?   // OpenAI-generated summary

  // --- 1. Audience ---
  primary_persona           ContentPersona?
  secondary_personas        Json?     // Array of ContentPersona
  seniority_level           SeniorityLevel?
  audience_domain           AudienceDomain?
  audience_targeting        AudienceTargeting?

  // --- 2. Offering context ---
  offering_content_type     OfferingContentType?
  lifecycle_stage           LifecycleStage?
  offering_notes            String?   // Free text if needed

  // --- 3. Primary intent ---
  primary_intent            PrimaryIntent?
  secondary_intents         Json?     // Array of SecondaryIntent

  // --- 4. Evidence & credibility ---
  evidence_types_used       Json?     // Array of EvidenceType
  evidence_strength         EvidenceStrength?

  // --- 5. Depth & specificity ---
  specificity_level         SpecificityLevel?
  actionability_level       ActionabilityLevel?

  // --- 6. Competitive signal ---
  competitive_posture       CompetitivePosture?
  competitive_direction     CompetitiveDirection?
  explicit_competitors      String?   // Comma-separated or JSON array of names
  category_framing          String?

  // --- 7. Sensitivity & risk ---
  sensitivity_level         SensitivityLevel?
  sensitivity_tone          SensitivityTone?
  trust_building_elements   String?

  // --- 8. Temporal ---
  timing_nature             TimingNature?
  urgency_level             UrgencyLevel?

  // --- 9. Strategic ---
  implied_strategic_direction String?  // Free text or structured; e.g. "Move upmarket, platform expansion"
  confidence_posture         ConfidencePosture?

  // --- 10. Call to action ---
  explicit_cta              String?
  implicit_cta               String?

  // --- Optional meta ---
  content_archetype         ContentArchetype?
  signal_strength_score     Int?      // 1–5

  // Raw extraction (optional, for debugging or re-processing)
  raw_extraction_json       Json?

  project         Project          @relation(fields: [project_id], references: [id])
  analysis_run    BlogAnalysisRun?  @relation(fields: [analysis_run_id], references: [id])

  @@unique([project_id, article_url])
  @@index([project_id])
  @@index([analysis_run_id])
  @@index([article_date])
  @@index([deleted_at])
}
```

Add to `Project`:

```prisma
  blogAnalysisRuns  BlogAnalysisRun[]
  blogNewsAnalyses  BlogNewsAnalysis[]
```

---

## 3. OpenAI instructions for analyzing each item

Use the following so the model **parses** the article text, **summarizes** it, and **fills** the structured dimensions. The pipeline should pass the **article text** (and optionally title, URL, date if already known) into the model and request **structured JSON** matching the schema below.

### 3.1 System prompt (high level)

```
You are an expert analyst of company communications: blog posts, press releases, and newsroom content. Your task is to read the provided article text and produce:
1. A concise summary (2–4 sentences).
2. A structured analysis across multiple dimensions (audience, offering context, intent, evidence, specificity, competitive signal, sensitivity, temporal and strategic signals, and call to action).

Be precise and evidence-based: choose the option that best fits the content. If something is unclear or not present, use null or the appropriate "none" / "mixed" option. Do not invent information that is not in the text.
```

### 3.2 Extraction schema (JSON shape for model output)

Ask the model to return a single JSON object per article with this structure. Enum values should match the Prisma enums (e.g. `DEVELOPER_ENGINEER`, `HIGH_LEVEL_CONCEPTUAL`). Use `null` when not applicable or unknown.

```json
{
  "summary": "2–4 sentence summary of the article.",
  "article_date": "YYYY-MM-DD or null if not found",
  "audience": {
    "primary_persona": "One of: DEVELOPER_ENGINEER, CTO_VP_ENGINEERING, CISO_SECURITY_LEADER, BUSINESS_BUYER, END_USER_CUSTOMER, INVESTOR_ANALYST, PARTNER_ECOSYSTEM, GENERAL_PUBLIC_PRESS",
    "secondary_personas": ["List of same enum values or empty array"],
    "seniority_level": "IC | MANAGER | EXECUTIVE | MIXED",
    "audience_domain": "TECHNICAL | BUSINESS | COMPLIANCE_LEGAL | MIXED",
    "audience_targeting": "EXPLICITLY_TARGETED | BROAD_MULTI_PERSONA"
  },
  "offering_context": {
    "offering_content_type": "NEW_PRODUCT | NEW_FEATURE | EXISTING_PRODUCT_ENHANCEMENT | REPOSITIONING_EXISTING_CAPABILITY | PACKAGING_PRICING_CHANGE | NO_PRODUCT_MENTIONED",
    "lifecycle_stage": "ANNOUNCEMENT | EARLY_ACCESS_BETA | GA_LAUNCH | ITERATION_IMPROVEMENT | DEPRECATION_SUNSET",
    "offering_notes": "Optional short free text"
  },
  "intent": {
    "primary_intent": "PRODUCT_FEATURE_ANNOUNCEMENT | COMPETITIVE_DIFFERENTIATION | CUSTOMER_PARTNER_ANNOUNCEMENT | TECHNICAL_EDUCATION_THOUGHT_LEADERSHIP | TRUST_RISK_REDUCTION | MARKET_POSITIONING_NARRATIVE_SHAPING | EVENT_PROMOTION_OR_RECAP | BRAND_CREDIBILITY | VISION_ROADMAP_SIGNALING",
    "secondary_intents": ["RECRUITING | INVESTOR_SIGNALING | SEO_DISCOVERABILITY | COMMUNITY_BUILDING or empty array"]
  },
  "evidence": {
    "evidence_types_used": ["CLAIMS_ONLY | METRICS_NUMBERS | CUSTOMER_QUOTES | LOGOS_NAMED_BRANDS | BENCHMARKS_COMPARISONS | THIRD_PARTY_VALIDATION"],
    "evidence_strength": "WEAK | MODERATE | STRONG"
  },
  "specificity": {
    "specificity_level": "HIGH_LEVEL_CONCEPTUAL | SEMI_TECHNICAL | DEEP_TECHNICAL | OPERATIONAL_TACTICAL",
    "actionability_level": "INFORMATIONAL_ONLY | EXPLAINS_HOW | INVITES_ACTION"
  },
  "competitive": {
    "competitive_posture": "EXPLICIT_COMPETITOR_COMPARISON | IMPLICIT_DIFFERENTIATION | CATEGORY_DEFINITION_REFRAMING | NO_COMPETITIVE_SIGNAL",
    "competitive_direction": "OFFENSIVE | DEFENSIVE or null if no competitive signal",
    "explicit_competitors": "Comma-separated names or null",
    "category_framing": "Short description of how category is framed or null"
  },
  "sensitivity": {
    "sensitivity_level": "LOW | MEDIUM | HIGH",
    "sensitivity_tone": "REASSURING | DEFENSIVE | CONFIDENT | TRANSPARENT_POST_INCIDENT or null",
    "trust_building_elements": "Short description or null"
  },
  "temporal": {
    "timing_nature": "PROACTIVE | REACTIVE | SEASONAL_CYCLICAL",
    "urgency_level": "IMMEDIATE | NEAR_TERM | LONG_TERM"
  },
  "strategic": {
    "implied_strategic_direction": "Short free text, e.g. move upmarket, platform expansion, vertical focus, trust/compliance investment, developer-first",
    "confidence_posture": "EXPLORATORY | ASSERTIVE | DEFENSIVE | EVANGELICAL"
  },
  "cta": {
    "explicit_cta": "Explicit call to action or null",
    "implicit_cta": "Implicit CTA or null"
  },
  "meta": {
    "content_archetype": "ANNOUNCEMENT | PROOF_POINT | NARRATIVE_SHAPING | DAMAGE_CONTROL | EVANGELISM",
    "signal_strength_score": 1
  }
}
```

`meta.signal_strength_score` is an integer from 1 to 5 (1 = weak signal, 5 = very strong).

### 3.3 User prompt template (per article)

Use this structure when sending one article to the model. Replace placeholders with actual values.

```
Analyze the following blog/news item and return a single JSON object that conforms to the extraction schema (audience, offering_context, intent, evidence, specificity, competitive, sensitivity, temporal, strategic, cta, meta). Use only the enum values listed in the schema; use null when not applicable.

Article URL: {{article_url}}
Article title: {{article_title}}
Publication date (if known): {{article_date}}

--- Article text ---
{{article_text}}
--- End ---

Return only valid JSON, no markdown or explanation.
```

### 3.4 Field-level instructions for the model (reference)

You can append this to the system or user prompt so the model interprets each dimension consistently:

**Audience**
- Primary persona: Who is the single most clearly targeted reader (role/title)?
- Secondary personas: Other audiences clearly addressed.
- Seniority: IC (individual contributor), Manager, or Executive focus.
- Domain: Technical, business, compliance/legal, or mixed.
- Explicit vs implicit: Explicitly targeted = clearly named audience; broad = multi-persona or generic.

**Offering context**
- Content relates to: What the piece is about (new product, new feature, enhancement, repositioning, packaging/pricing, or no product).
- Lifecycle stage: Where in the product lifecycle (announcement, beta, GA, iteration, deprecation).

**Intent**
- Primary: One main purpose from the list (announcement, differentiation, education, trust, positioning, event, credibility, vision).
- Secondary: Optional additional intents (recruiting, investor, SEO, community).

**Evidence**
- Types: Claims only, metrics, customer quotes, logos/brands, benchmarks, third-party validation (can select multiple).
- Strength: Weak (vague marketing), moderate (some specifics), strong (verifiable, concrete).

**Specificity**
- Technical depth: Conceptual, semi-technical, deep technical, or operational/tactical.
- Actionability: Informational only, explains how, or invites action (sign up, contact, attend).

**Competitive**
- Posture: Explicit comparison, implicit differentiation, category definition/reframing, or none.
- Direction: Offensive (we are better) or defensive (addressing concerns), or null if no signal.
- Explicit competitors: Names if mentioned.
- Category framing: How the category or market is framed.

**Sensitivity**
- Level: Low (marketing/culture), medium (technical/architecture), high (security/compliance/risk/outages).
- Tone: Reassuring, defensive, confident, or transparent/post-incident in sensitive areas.
- Trust-building: Short description of trust elements present.

**Temporal**
- Timing: Proactive (vision/roadmap), reactive (incident/regulation), or seasonal/cyclical.
- Urgency: Immediate, near-term, or long-term.

**Strategic**
- Implied direction: e.g. upmarket, platform expansion, vertical focus, ecosystem, trust/compliance, developer-first.
- Confidence: Exploratory, assertive, defensive, or evangelical.

**CTA**
- Explicit: Stated call to action (e.g. “Sign up”, “Contact sales”).
- Implicit: Unstated but clear next step.

**Meta**
- Archetype: Announcement, proof point, narrative shaping, damage control, evangelism.
- Signal strength: 1–5 (how strong and clear the content is as a signal).

---

## 4. Pipeline flow (summary)

1. **Input:** Project, set of starting URLs, `no_items_before_date`.
2. **Fetch:** For each URL, fetch page(s) and extract article list + per-article text (e.g. via your own fetcher or a generic crawler; no Apify blog scraper required).
3. **Filter:** Keep only items with `article_date >= no_items_before_date` (or no date → include or exclude by policy).
4. **Analyze:** For each article, call OpenAI with the user prompt above and the extraction schema; get back one JSON per article.
5. **Store:** Map JSON to `BlogNewsAnalysis`; insert only when `(project_id, article_url)` does not exist (deduplication). Optionally set `analysis_run_id` and update `BlogAnalysisRun.items_found_count` and status.
6. **Result:** Summarized list of news/blog items with full structured dimensions in the new table; no new rows when there are no new articles.

This schema and these instructions give you a single place to store blog/news analyses and a clear contract for the OpenAI API to parse and summarize each item and populate all required and optional data points.
