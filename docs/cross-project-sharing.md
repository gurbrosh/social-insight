# Cross-Project Data Sharing Feature Proposal

## Purpose

Enable multiple projects to share post records when they have overlapping keywords or brands, reducing redundant scraping and improving resource utilization.

## Problem Statement

Currently, each project maintains its own isolated set of scraped posts. If two projects share common keywords (e.g., "AI development", "Cursor") or brands (e.g., "OpenAI", "Microsoft"), the same posts get scraped multiple times, wasting:

- **Scraping resources** (API calls, compute time)
- **Storage space** (duplicate posts across projects)
- **Time** (re-scraping already collected data)

## Use Case Example

1. **Project 1** (User A): Keywords `["Cursor", "AI", "coding", "development"]`, Brands `["Microsoft", "OpenAI", "Google"]`
2. **Project 2** (User B): Keywords `["AI", "machine learning", "NLP"]`, Brands `["OpenAI", "Anthropic"]`

When Project 2 starts, it should automatically gain access to posts from Project 1 that match its keywords/brands (in this case: posts about "AI" and "OpenAI") without needing to re-scrape.

## Proposed Solution

### 1. Data Model Changes

#### New Junction Table: `PostProject`

Create a many-to-many relationship between posts and projects:

```prisma
model PostProject {
  id         String   @id @default("")
  post_id    Int
  project_id String
  added_at   DateTime @default(now())
  added_via  String?  // "scraped" | "matched" | "manual"
  
  post       Post     @relation(fields: [post_id], references: [id], onDelete: Cascade)
  project    Project  @relation(fields: [project_id], references: [id], onDelete: Cascade)
  
  @@unique([post_id, project_id])
  @@index([project_id])
  @@index([post_id])
  @@index([added_via])
}

// Update Post model
model Post {
  // ... existing fields ...
  postProjects PostProject[] // Remove existing project_id field or keep as original owner
}

// Update Project model
model Project {
  // ... existing fields ...
  postProjects PostProject[]
}

// Update ScrapeJob to track keywords/brands used
model ScrapeJob {
  // ... existing fields ...
  keywords_used String? // JSON array: ["keyword1", "keyword2"]
  brands_used   String? // JSON array: ["brand1", "brand2"]
}
```

### 2. Matching Algorithm

When a post is scraped for Project A:

1. **Store the post** (only once globally, deduplicated by `(platform, postId)`)
2. **Analyze content** against ALL active projects' keywords and brands
3. **Create PostProject entries** for each matching project
4. **Set `added_via`**:
   - `"scraped"` for the project that actually scraped it
   - `"matched"` for other projects that matched it

#### Matching Logic

```typescript
async function matchPostToProjects(postId: number): Promise<void> {
  const post = await prisma.post.findUnique({ 
    where: { id: postId },
    include: { postProjects: true } 
  });
  
  if (!post) return;
  
  // Get all active projects
  const projects = await prisma.project.findMany({
    where: { deleted_at: null },
    include: { keywords: true, brands: true }
  });
  
  for (const project of projects) {
    // Skip if already associated
    if (post.postProjects.some(pp => pp.project_id === project.id)) continue;
    
    const matches = checkPostMatchesProject(post, project);
    if (matches) {
      await prisma.postProject.create({
        data: {
          id: generateUlid(),
          post_id: post.id,
          project_id: project.id,
          added_via: project.id === post.project_id ? "scraped" : "matched"
        }
      });
    }
  }
}

function checkPostMatchesProject(post: Post, project: Project): boolean {
  const projectKeywords = project.keywords.map(k => k.keyword.toLowerCase());
  const projectBrands = project.brands
    .filter(b => b.is_selected)
    .map(b => b.brand_name.toLowerCase());
  
  const content = (post.content || "").toLowerCase();
  
  // Check keyword matches
  const keywordMatch = projectKeywords.some(keyword => 
    content.includes(keyword)
  );
  
  // Check brand matches
  const brandMatch = projectBrands.some(brand =>
    content.includes(brand) || content.includes(brand.toLowerCase())
  );
  
  return keywordMatch || brandMatch;
}
```

### 3. Retroactive Matching

When a new project is created:

1. **Find all existing posts** that match the new project's keywords/brands
2. **Create PostProject entries** for those matches
3. Set `added_via: "matched"` for all retroactive matches

This allows new projects to immediately see relevant historical data.

### 4. Query Changes

Instead of querying `Post` directly by `project_id`:

```typescript
// Old way
const posts = await prisma.post.findMany({
  where: { project_id: projectId }
});

// New way
const posts = await prisma.postProject.findMany({
  where: { project_id: projectId },
  include: { post: true }
});
```

### 5. Privacy & Security Considerations

**User Isolation:**
- Projects have `user_id` ownership
- Users can only see their own projects
- When querying matched posts, filter by projects owned by the user

**Query Pattern:**
```typescript
const userProjects = await prisma.project.findMany({
  where: { user_id: session.user.id, deleted_at: null },
  select: { id: true }
});

const projectIds = userProjects.map(p => p.id);

const posts = await prisma.postProject.findMany({
  where: { 
    project_id: { in: projectIds }
  },
  include: { post: true }
});
```

**Additional Privacy Controls:**
- Add `visibility` field to Project model: `"private" | "public" | "team"`
- Only share posts from public/team projects
- Users can opt-out of cross-project matching

### 6. Storage Optimization

**Current Problem:**
- Same post stored N times (once per project that scrapes it)

**Solution:**
- Posts stored once globally (deduplicated by `(platform, postId)`)
- Multiple projects reference the same post via `PostProject`
- Saves ~80-90% storage for overlapping projects

### 7. Additional Enhancements

#### Track Content Analysis
Add fields to Post for better matching:

```prisma
model Post {
  // ... existing fields ...
  keywords_detected String? // JSON array: detected keywords in content
  brands_detected   String? // JSON array: detected brands in content
  content_hash     String? // For exact duplicate detection
}
```

Populated during scraping or via background job.

#### Track Origin
Store which scraper/job produced the post:

```prisma
model ScrapeJob {
  keywords_used String? // JSON array
  brands_used   String? // JSON array
}
```

Helps answer: "Which keyword produced this post?"

## Implementation Steps

1. **Create migration** for `PostProject` table
2. **Update Post/Project models** to include many-to-many relation
3. **Add matching function** to check posts against all projects
4. **Update scrapers** to call matching function after storing posts
5. **Update queries** in all places that fetch posts by project
6. **Add retroactive matching** job for new projects
7. **Add analytics** to track savings (posts saved, scraping avoided)

## Migration Strategy

1. **Phase 1**: Create PostProject table alongside existing Post.project_id
2. **Phase 2**: Backfill PostProject from existing Post.project_id relationships
3. **Phase 3**: Implement new matching logic
4. **Phase 4**: Switch queries to use PostProject
5. **Phase 5**: Remove Post.project_id (optional, keep for original owner tracking)

## Benefits

1. **Resource Savings**: Eliminate redundant scraping
2. **Cost Reduction**: Fewer API calls
3. **Faster Setup**: New projects see immediate results
4. **Better Discovery**: Users find relevant content across projects
5. **Scalability**: Platform grows more efficient as it scales

## Challenges

1. **Privacy concerns**: Users may not want data shared
2. **Content matching accuracy**: False positives/negatives
3. **Performance**: Matching all posts against all projects at scrape time
4. **Complexity**: More complex queries, relationships to manage
5. **Data ownership**: Who "owns" a scraped post?

## Conclusion

This feature would significantly improve resource utilization and user experience by intelligently sharing content between projects with overlapping interests. The implementation requires careful consideration of privacy, matching accuracy, and performance implications.

**Status**: Proposed but not yet implemented. Awaiting further discussion and prioritization.
