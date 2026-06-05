# Chatter Analysis Thresholds Explained

## Overview

Chatter analysis identifies and stores relevant conversation threads from social media posts. A post must pass multiple filters to appear in the chatter section.

## Multi-Stage Filtering Process

### Stage 1: Thread Identification
**Requirement**: Post must be part of a conversation thread
- Root posts with replies (`threadRefId` pointing to them)
- **YouTube**: Video = root (from Search step); comments must have `threadRefId` set to the video ID so they attach as replies. The pipeline now transforms YouTube Comments Scraper output with `threadRefId` = video ID when the item has `videoId`/`video_id` and comment fields (`comment_id`, `comment_text`, etc.).
- Discord channel messages (grouped by channel)
- **Minimum conversation size**:
  - **Facebook**: ≥2 participants OR ≥2 replies
  - **Other platforms**: ≥2 participants OR ≥1 reply

**Why your post might fail here:**
- If it's a standalone post with no replies, it won't form a thread
- If it has replies but only 1 participant (author replying to themselves), it may not qualify
- **YouTube**: If comments were saved before the fix, they may have been stored without `threadRefId` (each as a root), so no video+comments thread was built. Re-scraping comments after the fix will attach them to the video for chatter.

### Stage 2: Embedding Similarity Prefilter
**Requirement**: Thread must be semantically similar to project essence
- Computes embeddings for all candidate threads
- Compares similarity to project essence (keywords, brands, monitoring focus)
- **Top 150 threads** selected by similarity (platform-balanced)
- Only these 150 threads proceed to relevance scoring

**Why your post might fail here:**
- If there are 150+ more relevant threads, this one might not make the cut
- The embedding similarity might be low if the content doesn't match project keywords/brands

### Stage 3: AI Relevance Scoring
**Requirement**: Thread must score above relevance threshold
- Each thread is scored 0-100 by AI (GPT-4o-mini) based on:
  - **Project Essence** (monitoring focus, keywords, brands, description)
  - **Semantic relevance** to project topic
  - **Content alignment** with what the project is looking for

**Relevance Score Thresholds:**
- **General platforms**: **≥50** (MIN_SCORE_TO_KEEP)
- **Facebook**: **≥40** (FACEBOOK_SCORE_THRESHOLD)

**Scoring Guidelines (from code):**
- **0-30**: Completely irrelevant - different topic/industry → **REJECTED**
- **31-49**: Marginally related but not actually about project → **REJECTED**
- **50-69**: Somewhat relevant - discusses related concepts
- **70-89**: Clearly relevant - directly discusses project
- **90-100**: Highly relevant - core discussion

**How Relevance is Evaluated:**
The AI considers **ALL** context together:
1. **Keywords** - Domain-specific keywords indicate broader domain interest. Content matching these keywords should score ≥50 even if it's about a different brand.
2. **Monitoring Focus** - Describes what the project is specifically looking for. If it mentions specific brands, those are prioritized, BUT keywords still matter.
3. **Brands** - Specific entities being monitored. Content about listed brands scores higher.
4. **Description** - General project context.

**Key Principle**: If your keywords are domain-specific, content matching those keywords is considered relevant EVEN if it's about a different brand than those listed. Keywords indicate broader domain interest.

**Why your post might fail here:**
- If the AI determines it's not semantically relevant to your project's domain (keywords + monitoring focus + brands combined)
- If it's about a completely different topic/industry
- If keywords are too generic and don't match the content meaningfully

### Stage 4: Deduplication
**Requirement**: Thread must not be a duplicate
- Removes threads with same day + platform + normalized content snippet
- Facebook threads also check post ID

### Stage 5: Importance Score Calculation
**Purpose**: Used for ranking, not filtering
- Based on engagement metrics (likes, comments, shares)
- Weighted by relevance score (prevents off-topic high-engagement items from ranking high)
- **UI Filter**: `minImportance: 10` (shows items with importance ≥10)

## Why Your Post Didn't Make It

A post about a brand or topic in your domain can still fail at Stage 3 (AI Relevance Scoring) if the specific brand isn't listed.

### Actual Analysis:

**Project configuration** (example):
- **Monitoring Focus**: What the project is looking for
- **Brands**: Listed project brands
- **Keywords**: Domain-specific keywords

**The Post:**
- About: A brand in the same domain that is NOT in the project's brand list
- Has: Multiple participants (10+), multiple replies, high engagement (likes 4-184)
- Clearly passed Stage 1 (thread identification) ✅

### Why It Failed:

**Stage 3: AI Relevance Scoring** - **CONFIRMED FAILURE**

The AI scoring function uses **MONITORING FOCUS as the PRIMARY semantic context**. The scoring prompt explicitly states:

> "⚠️ PRIMARY SEMANTIC CONTEXT: If a 'MONITORING FOCUS' is specified above, that is the PRIMARY guide for what this project is looking for."
> 
> "If MONITORING FOCUS exists: Content must align with what is described there - this is what the user is specifically looking for"

**The problem:** The old prompt prioritized monitoring focus over keywords. A post that matched domain keywords could be rejected if the specific brand wasn't in the list. Keywords should matter: content matching domain-specific keywords should be considered relevant even if it's about a different brand.

### Fix Applied:

The scoring prompt has been updated to:
1. **Consider keywords as domain indicators** - Content matching domain-specific keywords should score ≥50 even if it's about a different brand
2. **Balance monitoring focus and keywords** - Both are evaluated together
3. **Recognize broader domain interest** - Keywords indicate what domain the project cares about

**With the fix**, such a post should now score ≥40 when it matches the project's domain keywords.

### How to Include This Post:

After the fix, this post should now be included automatically. If it's still not appearing:
1. **Re-run the analysis** - The updated prompt will now consider keyword relevance
2. **Verify keywords are domain-specific** - Generic keywords might not trigger relevance
3. **Check if post was already processed** - You may need to wait for the next analysis run

## How to Check Why a Post Was Rejected

Look for these log messages in your server logs:

```
[Analysis] ⚠️  Rejecting high-engagement thread (engagement=X, participants=Y) due to low relevance score: Z < threshold
```

Or check the analysis logs:
```
[Analysis] Thread relevance scores — min: X, avg: Y, max: Z
[Analysis] Threads passing thresholds (default=50, facebook=40): N
```

## Current Thresholds Summary

| Stage | Requirement | Threshold |
|-------|-------------|-----------|
| Thread Formation | Participants/Replies | ≥2 participants OR ≥2 replies (FB) / ≥1 reply (others) |
| Embedding Filter | Similarity ranking | Top 150 threads |
| Relevance Score | AI relevance | ≥50 (general) / ≥40 (Facebook) |
| Importance Score | UI display | ≥10 (for ranking, not filtering) |

## Notes

- **High engagement alone doesn't guarantee inclusion** - relevance is the primary factor
- **Facebook has lower threshold (40)** because Facebook conversations tend to score lower
- **No fallback mechanism** - if no threads pass threshold, none are stored (prevents off-topic items)
- The system prioritizes **quality over quantity** - better to have fewer relevant conversations than many off-topic ones
