/**
 * Backfill Conversation and ConversationNode tables for existing projects.
 * Run once after schema migration to materialize conversations for all posts.
 *
 * Usage: npx tsx scripts/backfill-conversations.ts [projectId?]
 * If projectId is omitted, processes all projects.
 */

import { prisma } from "../lib/prisma";
import { materializeConversationsForProject } from "../lib/conversation-materializer";

async function main() {
  const projectIdArg = process.argv[2];
  const projectIds = projectIdArg
    ? [projectIdArg]
    : (await prisma.project.findMany({ where: { deleted_at: null }, select: { id: true } })).map(
        (p) => p.id
      );

  console.log(`[Backfill] Processing ${projectIds.length} project(s)...`);
  let totalConversations = 0;
  let totalNodes = 0;
  let totalPosts = 0;

  for (const projectId of projectIds) {
    try {
      const result = await materializeConversationsForProject(projectId);
      totalConversations += result.conversationsCreated;
      totalNodes += result.nodesCreated;
      totalPosts += result.postsUpdated;
    } catch (err) {
      console.error(`[Backfill] Failed for project ${projectId}:`, err);
      throw err;
    }
  }

  console.log(
    `[Backfill] Done. conversations=${totalConversations} nodes=${totalNodes} postsUpdated=${totalPosts}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
