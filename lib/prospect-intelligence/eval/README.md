# Classification evaluation harness

This folder holds **regression tests and aggregate metrics** for LinkedIn prospect classification. It does **not** embed golden examples into production classifier logic.

## Architecture direction (target state)

The classifier should move toward **staged composition**, not a growing list of headline `if/else` rules:

1. **Evidence normalization** — Unicode/stylized text cleanup; original vs normalized headline; segments; sources (headline, post, badge metadata, profile when available).
2. **Structured extraction** — Employment/education/past candidates, Open-to-Work, explicit founder/owner/investor/student signals. Deterministic where confidence is high; **avoid broad role inference** here.
3. **Deterministic guardrails** — Negative guardrails only (e.g. Open Source vs Open-to-Work, “at scale”, Former/Previously routing, education-shaped spans not as current employer, founder requiring explicit wording). **Not** thousands of title variants.
4. **Semantic / LLM role layer** — Open-ended persona, `role_categories`, `function_tags`, `seniority`, ambiguity. **Employment confidence** and **role labels** stay conceptually separate: if title/company are ambiguous, null them and set review flags without forcing `role_categories = unknown` when context is otherwise clear.
5. **Output validation** — Contradiction checks before return (founder vs evidence, education vs `current_*`, unknown + rich tags, generic safe references vs specific roles, sentence fragments in `current_company`).

The **golden JSON file is a test suite**, not a rules engine. The **CSV script** is for stability tracking on real exports, not for encoding business routing.

## Files

| File | Role |
|------|------|
| `golden-types.ts` | TypeScript shape for `GoldenExpect` / fixtures / suite file. |
| `golden-fixtures.json` | Partial-assertion cases (OTW, founder, education, past roles, semantic non-unknown, etc.). |
| `run-golden.ts` | Loads fixtures, runs `gatherProspectEvidence` + `classifyProspectDeterministic`, asserts partial expectations. |
| `parse-csv.ts` | Minimal CSV parse for exports. |
| `run-csv-eval.ts` | Aggregate metrics, suspicious-row ranking, thresholds, optional baseline JSON. |
| `sample-eval-output.txt` | Example `classify:evaluate` run on a 288-row slice (see file header). |

## Golden fixture format (`GoldenExpect`)

Partial assertions only (no full output equality). Supported fields include:

- `roleCategoriesIncludes` / `roleCategoriesIncludesAnyOf` / `roleCategoriesExcludes`
- `profileFlagsIncludes` / `profileFlagsIncludesAnyOf` / `profileFlagsExcludes`
- `functionTagsIncludes` / `functionTagsIncludesAnyOf` / `functionTagsExcludes`
- `openToWorkStatus`, `openToWorkEvidenceSource`
- `currentTitleIsNull`, `currentTitleEquals`, `currentTitleContains`, `currentTitleExcludes`, `currentTitleNotEquals`
- `currentCompanyIsNull`, `currentCompanyEquals`, `currentCompanyContains`, `currentCompanyExcludes`
- `educationAreaContains`, `educationInstitutionContains`
- `pastTitleContains`, `pastCompanyContains`, `pastCompanyContainsAll`
- `safeProfessionalReferenceContains`, `needsReview`, `seniorityEquals`

Fixture-level optional `tier: \"informational\"` was **removed**; all cases are **blocking** under strict golden runs. Use `--soft` to print mismatches as warnings without exiting.

## npm commands

```bash
npm run classify:test-golden              # strict: exit 1 on any blocking golden failure
npm run classify:test-golden -- --soft   # warnings only, exit 0
npm run classify:evaluate -- path/to.csv [--baseline metrics.json] [--soft]
npm run classify:test-all                  # soft golden + unit classify tests (exit 0 unless unit tests fail)
```

## CSV eval: pass/fail philosophy

**Stability over perfection.** Gates are split so semantic/label gaps surface mainly in **golden** tests, while CSV checks catch **export hygiene** and **sample drift**.

### Hard failures (280–300 row band, unless `--soft`)

- `unknown-only` + `needs_review=no` → any is a hard fail.
- `current_company` matching hard “Former / Previously / at Scale / …” patterns (sentence fragments in company).

### Warnings

- Unknown-only rate \> 15%
- Unknown + both `current_title` and `current_company` \> 3
- Unknown-only + meaningful `function_tags` \> 5
- Founder rate unusually high; founder ∩ investor overlap \> 1
- Founder role without `founder_signal`; venture-investor-style headline with founder role; education-shaped titles
- Generic `safe_professional_reference` phrase counts vs `--baseline` JSON; high `needs_review` rate vs baseline

**Golden suite** is the right place to enforce Open-to-Work false positives, founder false positives, and education-vs-employment **per headline**, without turning those headlines into code paths.

### Baseline JSON (optional)

```json
{
  "version": 1,
  "generic_safe_reference_counts": {
    "your perspective shared on the thread": 21,
    "your professional background": 42,
    "your technical and infrastructure work": 0
  },
  "needs_review_rate_pct": 57.0,
  "unknown_only_pct": 27.4
}
```

## What fails **today** (deterministic classifier, no semantic layer yet)

### Strict golden (`npm run classify:test-golden`)

Five blocking mismatches on the current suite (examples: sales/architect/`investor_signal`/`venture_capital` labels not yet aligned with expectations). Run with `--soft` to see the same as warnings.

### CSV sample (`sample-eval-output.txt`)

On the saved **288-profile** slice:

- **Hard:** one row with `current_company` still containing a `. Former…` style fragment (Check Point / past employers swallowed into company).
- **Warnings:** ~27% unknown-only, 13 unknown rows with title+company, 25 unknown rows with meaningful `function_tags`, founder heuristics, overlap, high `needs_review`, no baseline file.

That split matches the intended direction: **hygiene hard-fails on exports**, **role semantics** driven toward golden + future semantic stage rather than more brittle string rules in `classify.ts`.
