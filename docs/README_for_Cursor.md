# How to Use These Docs in Cursor Planner Mode

## Recommended Approach
Give Cursor all of these documents at once, plus a short instruction telling it what to do with them.

That works better than feeding them one by one because:
- Cursor can see the full feature shape
- It can connect data model, prompts, UI, and pipeline design
- It is less likely to make local decisions that conflict with the broader design

## Recommended Instruction to Paste Alongside These Docs

Use the attached planning documents as the source of truth for designing and implementing the Theme-Based Response Generator feature.

Please do the following:
1. Review all documents together
2. Identify any architectural gaps or implementation risks
3. Propose a concrete implementation plan for this codebase
4. Map the feature into backend services, storage, OpenAI integration, and UI
5. Break the work into buildable phases and tasks
6. Call out any assumptions that need validation against the current codebase
7. Then begin implementation with the lowest-risk foundational pieces first

Important constraints:
- Keep the feature synchronous
- Batch OpenAI work in groups of 50 theme items
- Only generate responses when relevance >= 0.7
- Skip theme items that already have responses
- Show only a Response indicator in the Themes table
- Show full response details inside the Theme Details view
- Support multiple Response Objectives per project
- Generate platform-specific responses
- Avoid promotional tone

## Suggested Sequence for Cursor
1. Read all docs
2. Inspect current project architecture
3. Produce a gap analysis
4. Produce an implementation plan specific to the repo
5. Start building data model and orchestration first
6. Then add prompt builders and services
7. Then wire UI

## Note
If Cursor finds conflicts between these documents and the existing codebase, it should preserve the intent of the feature while adapting implementation details to the current architecture.
