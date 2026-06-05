# Acceptance Criteria: Response Generator

## Functional
- Responses are generated only if relevance ≥ 0.7
- Responses are platform-aware
- Persona is applied
- Responses are stored correctly
- UI shows response availability and details

## Non-Functional
- No rate limit failures in normal operation
- Clean UI
- Deterministic output format

## Edge Cases
- No user → fallback
- Low relevance → skip
- Existing response → skip
- Dead threads → allowed but likely low relevance
