# News Analysis System

## Overview

The News Analysis system automatically extracts newsworthy items, trends, and insights from collected social media posts. It runs automatically after sentiment analysis and uses OpenAI's GPT-4o to intelligently batch and analyze posts.

## Architecture

### Key Components

1. **News Analysis Service** (`lib/news-analysis.ts`)
   - Batches posts by platform/source
   - Builds thread hierarchies for Reddit and X
   - Sends batched content to OpenAI
   - Stores results in PostNews table

2. **News Analysis API** (`app/api/news-analysis/route.ts`)
   - POST: Run news analysis on project
   - GET: Retrieve news items

3. **Integration with Sentiment Analysis** (`app/api/sentiment-analysis/route.ts`)
   - News analysis runs automatically after sentiment analysis
   - Can be disabled by passing `runNewsAnalysis: false`

4. **PostNews Database Table**
   - Stores extracted news items
   - Links to project and original posts
   - Includes sentiment, importance score, tags

## Thread Tracing for Reddit & X

### How It Works

The system uses the `threadRefId` field in the Post model to trace comments back to their root posts:

- **Reddit**: `threadRefId` contains the `parent_id` of the comment
- **X (Twitter)**: `threadRefId` contains the `in_reply_to_status_id_str`

### Thread Hierarchy Algorithm

```typescript
// For Reddit and X:
1. Separate posts into root posts (no threadRefId) and comments (has threadRefId)
2. For each root post:
   - Find direct replies (threadRefId === root.postId)
   - Find nested replies (traverse up the chain)
   - Group all related comments into one thread

// For other platforms (Facebook, LinkedIn, Discord):
- Each post is treated as its own "thread" 
- Comments are included in the content when available
```

### Example Thread Structure

```
Root Post (postId: "abc123")
├── Comment 1 (threadRefId: "abc123")
├── Comment 2 (threadRefId: "abc123")
│   └── Reply to Comment 2 (threadRefId: "comment2_id")
└── Comment 3 (threadRefId: "abc123")
```

## Batching Strategy

### By Source/Platform

Posts are grouped by platform before analysis:
- Facebook posts analyzed together
- LinkedIn posts analyzed together  
- X posts analyzed together
- Reddit posts analyzed together
- Discord posts analyzed together

### Batch Size Configuration

Configurable via AppConfig table:
- `news_batch_size` (default: 20 threads per API call)
- `news_batch_delay` (default: 2000ms between batches)

### Why Batch by Source?

1. **Context**: Similar platforms have similar content patterns
2. **Efficiency**: Reduces API calls vs. individual post analysis
3. **Quality**: Better news extraction when analyzing related content together
4. **Cost**: More efficient use of OpenAI API tokens

## OpenAI Integration

### Model Used

- **GPT-4o**: The more capable model for complex analysis
- Sentiment analysis uses GPT-4o-mini (faster/cheaper)
- News analysis uses GPT-4o (better quality)

### Prompt Design

The system instructs OpenAI to identify:
- **Breaking News**: Time-sensitive events
- **Trends**: Emerging patterns
- **Insights**: Valuable observations
- **Controversies**: Debates
- **Announcements**: Product launches, updates

### Extracted Data

For each news item:
```json
{
  "title": "News headline",
  "summary": "Brief summary",
  "content": "Detailed description",
  "sentiment": "POSITIVE|NEGATIVE|NEUTRAL|MIXED",
  "importance_score": 75,
  "tags": ["keyword1", "keyword2"],
  "post_ids": [123, 456, 789],
  "date_range_start": "2025-01-01T00:00:00Z",
  "date_range_end": "2025-01-02T00:00:00Z"
}
```

## API Usage

### Run News Analysis

```bash
POST /api/news-analysis
{
  "projectId": "01HXYZ...",
  "dateRangeStart": "2025-01-01T00:00:00Z",  // optional
  "dateRangeEnd": "2025-01-31T23:59:59Z",    // optional
  "platforms": ["reddit", "x"]                // optional
}
```

### Get News Items

```bash
GET /api/news-analysis?projectId=01HXYZ...&limit=50&offset=0&minImportance=50
```

### Run Sentiment + News Analysis Together

```bash
POST /api/sentiment-analysis
{
  "projectId": "01HXYZ...",
  "runNewsAnalysis": true  // default: true
}
```

## Data Flow

### Orchestration Workflow (Automatic)

```
1. Orchestration runs scrapers
   ↓
2. New posts collected and saved
   ↓
3. Orchestration completes
   ↓
4. Sentiment analysis automatically runs
   - Only on posts where sentiment = null
   - Processes individual posts
   ↓
5. News analysis automatically runs
   - Only on posts where sentiment ≠ null
   - Groups by platform
   - Builds thread hierarchies (Reddit, X)
   - Batches and sends to OpenAI
   ↓
6. News items extracted and saved to PostNews table
   ↓
7. Complete!
```

### Manual Workflow (API)

```
POST /api/sentiment-analysis
{
  "projectId": "...",
  "runNewsAnalysis": true  // triggers news after sentiment
}
```

Or run separately:

```
POST /api/news-analysis
{
  "projectId": "...",
  "requireSentiment": true  // default, only analyzes posts with sentiment
}
```

## Conditional Analysis (Implemented)

### ✅ Sentiment-Based Filtering

News analysis now **only processes posts that have been sentiment analyzed**:

```typescript
// Default behavior - only analyze posts with sentiment
await analyzeProjectNews(projectId, {
  requireSentiment: true // Default: true
});

// Override to analyze all posts (not recommended)
await analyzeProjectNews(projectId, {
  requireSentiment: false
});
```

**Benefits:**
- Only posts that have been sentiment analyzed are included
- Avoids analyzing posts without context
- More efficient processing
- Ensures data quality

**Integration with Orchestration:**
When orchestrations complete:
1. Sentiment analysis runs first on posts without sentiment
2. News analysis automatically runs after sentiment completes
3. News analysis only processes posts with sentiment values
4. Both complete before orchestration is marked as done

## PostNews Table Schema

```sql
CREATE TABLE "PostNews" (
    "id" TEXT PRIMARY KEY,              -- ULID
    "created_at" DATETIME,
    "updated_at" DATETIME,
    "deleted_at" DATETIME,
    
    -- Core fields
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    
    -- Relationships
    "project_id" TEXT NOT NULL,         -- FK to Project
    "post_ids" TEXT,                    -- JSON array of post IDs
    
    -- Time range
    "date_range_start" DATETIME,
    "date_range_end" DATETIME,
    
    -- Analysis metadata
    "sources" TEXT,                     -- JSON array ['reddit', 'x']
    "sentiment" TEXT,                   -- Overall sentiment
    "importance_score" INTEGER,         -- 0-100
    "tags" TEXT                         -- JSON array of keywords
);
```

## Performance Considerations

### API Rate Limits
- OpenAI rate limits vary by tier
- Batch delays prevent hitting limits
- Configurable via AppConfig

### Token Usage
- ~1000 tokens per batch (input)
- ~500 tokens per batch (output)
- 20 threads/batch = ~30 posts
- Cost: ~$0.005 per batch (GPT-4o)

### Processing Time
- Sentiment: ~2-3 posts/second
- News: ~20 threads/batch, ~3 seconds/batch
- Example: 1000 posts = ~10 minutes total

## Configuration

Add to AppConfig table:

```sql
-- News analysis batch size (threads per API call)
INSERT INTO AppConfig (category, key, value, data_type, description) 
VALUES ('performance', 'news_batch_size', '20', 'number', 'Number of threads to analyze per OpenAI API call');

-- Delay between news analysis batches (milliseconds)
INSERT INTO AppConfig (category, key, value, data_type, description)
VALUES ('performance', 'news_batch_delay', '2000', 'number', 'Delay in ms between news analysis batches');
```

## Error Handling

- **Sentiment analysis fails**: News analysis skipped
- **News analysis fails**: Logged but doesn't fail sentiment
- **OpenAI API error**: Returns empty news array
- **Invalid JSON response**: Logged and skipped

## Monitoring

Key metrics to track:
- News items extracted per project
- Processing time per platform
- OpenAI API usage/costs
- Error rates

## Testing

### Manual Test
```bash
# 1. Run sentiment analysis with news analysis
curl -X POST http://localhost:3000/api/sentiment-analysis \
  -H "Content-Type: application/json" \
  -d '{"projectId": "YOUR_PROJECT_ID"}'

# 2. Get news items
curl "http://localhost:3000/api/news-analysis?projectId=YOUR_PROJECT_ID&limit=10"
```

### Expected Output
- News items with titles, summaries, and metadata
- Importance scores to prioritize items
- Tags for categorization
- Post IDs for traceability

## Admin Dashboard Access

News items will automatically appear in:
- Admin Database Viewer: `/admin/database` → PostNews table
- News Analysis Tab: `/projects/[id]` → News tab (to be implemented)

