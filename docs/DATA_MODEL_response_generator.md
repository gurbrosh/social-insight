# Data Model: Response Generator

## ResponseObjective

```ts
ResponseObjective {
  id: string
  project_id: string
  name: string
  description: string

  allowed_sources: string[]
  excluded_sources: string[]

  persona: "Founder" | "CTO" | "Engineering" | "Marketing" | "Sales"
  is_org_identified: boolean

  relevance_guidelines: string
  style_guidelines: string

  example_responses: {
    platform: string
    examples: string[]
  }[]

  created_at: timestamp
}
```

## ThemeItemResponse

```ts
ThemeItemResponse {
  id: string
  theme_item_id: string
  response_objective_id: string

  platform: string

  relevance_score: number
  reasoning: string

  target_user: string
  persona: string

  response_text: string

  created_at: timestamp
}
```

## Themes Table UI Only
Add:
- response_available: boolean

Full response details should be shown in the Details view only.
