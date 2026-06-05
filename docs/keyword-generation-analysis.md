# Keyword Generation Analysis & Fix Plan

## Problem Statement

For "Lovable" (a leading prompt-to-app platform), OpenAI generated incorrect keywords:
- copilots/agents
- assistants
- chatbots
- emotion recognition
- emotional ai

These keywords are completely wrong for a prompt-to-app platform and create a critical issue for brand discovery and project matching.

## Root Cause Analysis

### Issue 1: Missing Brand Context
**Current State:**
- The prompt only includes: `company_name`, `brand_name`, `category`, `stage`
- **Website URL is NOT included** even though it's available in `DiscoveredBrand`
- OpenAI has no way to know what the brand actually does

**Impact:** OpenAI relies on its training data, which may be outdated or incorrect. Without the website URL, it can't verify what the brand actually does.

### Issue 2: Forced Keyword Overlap
**Current State:**
```
IMPORTANT: Other companies in this same category use these keywords: [...]. 
Ensure at least 2-3 of your generated keywords overlap with or are similar to 
these existing keywords to maintain consistency within the category.
```

**Problem:** This forces OpenAI to generate generic category keywords instead of brand-specific ones. If other brands in "AI Application Builders" have keywords like "copilots", "assistants", "chatbots", OpenAI will prioritize matching those over what Lovable actually does.

**Impact:** Keywords become generic category descriptors rather than brand-specific identifiers.

### Issue 3: Conflicting Instructions
**Current State:**
- Point 1: "Accurately reflect what this specific brand is really known for"
- Point 4: "Overlap with existing keywords in this category"

**Problem:** These instructions conflict. The first says "brand-specific" while the second says "match others in category".

### Issue 4: No Brand Description
**Current State:** The prompt doesn't ask OpenAI to describe what the brand does before generating keywords.

**Impact:** OpenAI jumps straight to keyword generation without understanding the brand's actual offering.

### Issue 5: Temperature Too High
**Current State:** `temperature: 0.7`

**Problem:** Higher temperature = more creative but less accurate. For keyword generation, we need accuracy over creativity.

### Issue 6: Weak System Message
**Current State:** 
```
"You are a keyword research expert. Generate relevant, searchable keywords in valid JSON array format only."
```

**Problem:** Too generic, doesn't emphasize accuracy or brand-specificity.

## Proposed Solution

### Phase 1: Add Website URL to Prompt (Critical)
**Change:** Include `website_url` in the prompt and instruct OpenAI to use it as the primary source of truth.

**Implementation:**
```typescript
const websiteContext = brand.website_url
  ? `\n\nCRITICAL: Website URL: ${brand.website_url}\n- Visit this website or use your knowledge about this specific website\n- Understand what this brand actually does based on the website\n- Generate keywords based on what the website shows, not generic category assumptions\n`
  : "";
```

### Phase 2: Remove Forced Overlap Requirement
**Change:** Make overlap optional and secondary to brand-specificity.

**New Approach:**
- First priority: Brand-specific keywords based on what the brand actually does
- Second priority: Category consistency (only if it makes sense)
- Remove the "ensure 2-3 overlap" requirement

### Phase 3: Two-Step Process
**Change:** First ask OpenAI to describe what the brand does, then generate keywords based on that description.

**Implementation:**
1. Step 1: "Based on the website URL and brand information, describe what this brand does in 1-2 sentences"
2. Step 2: "Generate keywords based on that description"

### Phase 4: Improve Prompt Structure
**Changes:**
- Add explicit examples of good vs bad keywords
- Emphasize brand-specificity over category matching
- Lower temperature to 0.3 for more accurate results
- Strengthen system message to emphasize accuracy

### Phase 5: Add Validation Step
**Change:** After keyword generation, validate that keywords make sense for the brand.

**Implementation:**
- Check if keywords are too generic
- Verify keywords relate to the brand's actual offering
- Flag potential issues for manual review

## Detailed Fix Plan

### Step 1: Update `generateKeywordsForBrand` Function

**Key Changes:**
1. Include `website_url` in prompt
2. Remove forced overlap requirement
3. Add brand description step
4. Lower temperature to 0.3
5. Add examples of good/bad keywords
6. Strengthen system message

### Step 2: Update Prompt Structure

**New Prompt Flow:**
1. Brand Information (name, website, category)
2. Instruction to analyze website/what brand does
3. Generate brand-specific keywords
4. Optional: Check for category consistency (but don't force)

### Step 3: Add Post-Processing Validation

**Validation Rules:**
- Keywords should not be too generic (e.g., "ai", "technology", "software")
- Keywords should relate to the brand's actual offering
- Keywords should be searchable/social-media-relevant

### Step 4: Update `searchBrandWithOpenAI` Function

**Change:** Apply same improvements to keyword generation in brand search flow.

## Implementation Priority

1. **CRITICAL:** Add website_url to prompt (immediate fix)
2. **HIGH:** Remove forced overlap requirement
3. **HIGH:** Lower temperature to 0.3
4. **MEDIUM:** Add brand description step
5. **MEDIUM:** Add validation
6. **LOW:** Add examples to prompt

## Expected Outcome

After fixes:
- Keywords will be brand-specific and accurate
- Keywords will reflect what the brand actually does (based on website)
- Keywords will be useful for brand discovery and project matching
- Less generic/category-based keywords
- Better accuracy for brand suggestions

## Testing Strategy

1. Test with known brands (Lovable, Cursor, etc.)
2. Verify keywords match brand's actual offering
3. Check that keywords are useful for discovery
4. Ensure keywords don't become too generic


