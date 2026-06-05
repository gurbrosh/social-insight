# System Design: Response Generator

## Architecture
Use a two-stage LLM pipeline:
1. Relevance Evaluation
2. Response Generation

## Processing Loop

```ts
for each ThemeItem:
  if responses exist → skip

  for each active ResponseObjective:
    if platform not allowed → skip

    relevance = evaluate()

    if relevance >= 0.7:
      response = generate()
      store ThemeItemResponse
```

## Batching
- Batch size: 50 Theme items
- Process sequentially
- Prevent OpenAI rate limits

## Services

### RelevanceService
Returns score and reasoning.

### ResponseService
Generates final response.

### PromptBuilder
Builds prompts from structured config.

### TargetUserExtractor
Extracts reply target.

## Platform Handling
Platform must be passed into:
- relevance evaluation
- response generation
