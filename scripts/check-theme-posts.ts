import { prisma } from "../lib/prisma";

async function main() {
  const themeName = "Passengers misbehaving";

  // Find the theme (SQLite doesn't support case-insensitive, so we'll filter manually)
  const allThemes = await prisma.projectTheme.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      id: true,
      theme_name: true,
      project_id: true,
    },
  });

  const theme = allThemes.find((t) => t.theme_name.toLowerCase().includes(themeName.toLowerCase()));

  if (!theme) {
    console.log(`Theme "${themeName}" not found`);
    process.exit(1);
  }

  console.log(`Found theme: ${theme.theme_name} (ID: ${theme.id})`);
  console.log(`Project ID: ${theme.project_id}\n`);

  // Get all theme matches for this theme
  const themeMatches = await prisma.themesAnalysis.findMany({
    where: {
      theme_id: theme.id,
      deleted_at: null,
    },
    select: {
      id: true,
      post_id: true,
      platform: true,
      post_content: true,
      post_url: true,
      author_name: true,
      posted_at: true,
      relevance_score: true,
    },
    orderBy: { posted_at: "desc" },
  });

  console.log(`Found ${themeMatches.length} theme matches\n`);

  if (themeMatches.length === 0) {
    console.log("No matches found");
    process.exit(0);
  }

  // Get all posts referenced by these theme matches
  const postIds = themeMatches.map((tm) => tm.post_id);
  const posts = await prisma.post.findMany({
    where: {
      id: { in: postIds },
    },
    select: {
      id: true,
      postId: true,
      threadRefId: true,
      platform: true,
      content: true,
      url: true,
      authorName: true,
      createdAt: true,
    },
  });

  const postMap = new Map(posts.map((p) => [p.id, p]));
  const postIdMap = new Map(posts.map((p) => [p.postId, p]));

  // Helper to find root post (with Facebook story_fbid support)
  const findRootPost = (postId: number): { id: number; postId: string; isRoot: boolean } => {
    const post = postMap.get(postId);
    if (!post) {
      return { id: postId, postId: "unknown", isRoot: true };
    }

    if (!post.threadRefId) {
      return { id: post.id, postId: post.postId, isRoot: true };
    }

    // Handle Facebook-specific: check if threadRefId matches a story_fbid from root post URL
    if (post.platform.toLowerCase() === "facebook" && post.threadRefId) {
      // Check if any root post has a URL with matching story_fbid
      for (const rootPost of posts.filter((p) => !p.threadRefId && p.platform === post.platform)) {
        if (rootPost.url) {
          const storyFbidMatch = rootPost.url.match(/story_fbid=([^&]+)/);
          if (storyFbidMatch && storyFbidMatch[1] === post.threadRefId) {
            return { id: rootPost.id, postId: rootPost.postId, isRoot: true };
          }
        }
      }
    }

    // Traverse up
    let currentRefId: string | null | undefined = post.threadRefId;
    const visited = new Set<string>();
    let depth = 0;
    const MAX_DEPTH = 50;

    while (currentRefId && depth < MAX_DEPTH) {
      if (visited.has(currentRefId)) break;
      visited.add(currentRefId);

      const parentPost = postIdMap.get(currentRefId);
      if (!parentPost) break;

      if (!parentPost.threadRefId) {
        return { id: parentPost.id, postId: parentPost.postId, isRoot: true };
      }

      currentRefId = parentPost.threadRefId;
      depth++;
    }

    return { id: post.id, postId: post.postId, isRoot: false };
  };

  // Group by root post
  const rootPostGroups = new Map<
    number,
    Array<{ match: (typeof themeMatches)[0]; post: (typeof posts)[0] }>
  >();

  for (const match of themeMatches) {
    const post = postMap.get(match.post_id);
    if (!post) {
      console.log(`⚠️  Post ${match.post_id} not found in database`);
      continue;
    }

    const root = findRootPost(match.post_id);
    if (!rootPostGroups.has(root.id)) {
      rootPostGroups.set(root.id, []);
    }
    rootPostGroups.get(root.id)!.push({ match, post });
  }

  console.log(`\n📊 Analysis Results:\n`);
  console.log(`Total theme matches: ${themeMatches.length}`);
  console.log(`Unique root posts: ${rootPostGroups.size}\n`);

  // Show details for each root post group
  let groupNum = 1;
  for (const [rootPostId, group] of rootPostGroups.entries()) {
    const rootPost = postMap.get(rootPostId);
    const isRootPostInGroup = group.some((g) => g.post.id === rootPostId);

    console.log(`\n${"=".repeat(80)}`);
    console.log(
      `Group ${groupNum}: Root Post ID ${rootPostId} (${group.length} match${group.length > 1 ? "es" : ""})`
    );
    console.log(`${"=".repeat(80)}`);

    if (rootPost) {
      console.log(`\n📍 Root Post:`);
      console.log(`   ID: ${rootPost.id}`);
      console.log(`   Platform ID: ${rootPost.postId}`);
      console.log(`   Platform: ${rootPost.platform}`);
      console.log(`   Author: ${rootPost.authorName || "Unknown"}`);
      console.log(`   Created: ${rootPost.createdAt.toISOString()}`);
      console.log(`   URL: ${rootPost.url || "N/A"}`);
      console.log(`   Content preview: ${(rootPost.content || "").substring(0, 100)}...`);
      console.log(
        `   Has threadRefId: ${rootPost.threadRefId ? "YES (shouldn't happen)" : "NO (root)"}`
      );
    } else {
      console.log(`\n⚠️  Root post ${rootPostId} not found in database`);
    }

    if (group.length > 1) {
      console.log(`\n📝 Replies in this thread (${group.length - (isRootPostInGroup ? 1 : 0)}):`);
      for (const { match, post } of group) {
        if (post.id === rootPostId) continue; // Skip root, already shown
        console.log(`\n   Reply Post ID: ${post.id}`);
        console.log(`   Platform ID: ${post.postId}`);
        console.log(`   Author: ${post.authorName || "Unknown"}`);
        console.log(`   Created: ${post.createdAt.toISOString()}`);
        console.log(`   Relevance: ${match.relevance_score || "N/A"}%`);
        console.log(`   Content preview: ${(post.content || "").substring(0, 80)}...`);
      }
    } else if (!isRootPostInGroup) {
      console.log(`\n   (This is a reply, root post shown above)`);
    }
    groupNum++;
  }

  // Summary
  console.log(`\n\n${"=".repeat(80)}`);
  console.log(`📈 Summary:`);
  console.log(`${"=".repeat(80)}`);
  console.log(`Total theme matches: ${themeMatches.length}`);
  console.log(`Unique threads: ${rootPostGroups.size}`);

  if (rootPostGroups.size === 1) {
    console.log(
      `\n✅ All ${themeMatches.length} matches are from the SAME thread (root post ID: ${Array.from(rootPostGroups.keys())[0]})`
    );
  } else {
    console.log(`\n⚠️  Matches are from ${rootPostGroups.size} DIFFERENT threads:`);
    for (const [rootId, group] of rootPostGroups.entries()) {
      console.log(`   - Root ${rootId}: ${group.length} match${group.length > 1 ? "es" : ""}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
