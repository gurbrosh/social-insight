# Theme-Based Response Generator

## Summary
Build a system that generates platform-aware, non-promotional responses to social media conversations identified via Theme matches.

The system:
- Evaluates relevance of each Theme item to one or more Response Objectives
- Generates responses only if relevance threshold is met
- Stores and surfaces responses in the UI for user copy/paste

This is a closed loop system:

ingest → analyze → detect → respond

## Goals
- Generate high-quality, authentic responses
- Maintain strict relevance filtering
- Match platform-native tone
- Avoid promotional or spam-like output

## Non-Goals
- No auto-posting
- No editing inside the app
- No multiple response variants in v1
- No persona-level example customization in v1

## Key Concepts

### Theme Item
Existing unit representing a matched conversation.

### Response Objective
Defines:
- What we want to achieve, for example promote AgentSH
- Where to respond, via platform filtering
- How to respond, via style, persona, and tone

Multiple objectives per project are supported.

## High-Level Flow

```text
Theme Items
  → Relevance Evaluation
  → Filter (threshold >= 0.7)
  → Response Generation
  → Store
  → UI (Table + Details View)
```

## Constraints
- Only generate responses if relevance ≥ 0.7
- Platform-aware output is required
- Output must not sound promotional
- Batch size = 50
- Execution is synchronous

## Output Visible to User
Each response includes:
- relevance_score
- reasoning (1 sentence)
- target_user
- persona
- response_text
