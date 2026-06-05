/**
 * Runnable checks for Discord reply-forest threading (no test runner dependency).
 * Run: npx tsx lib/conversation-builder-discord.test.ts
 */
import assert from "node:assert/strict";
import {
  buildDiscordReplyForestThreads,
  findDiscordPartitionRoot,
  type PostForThread,
} from "@/lib/conversation-builder";

function dPost(
  id: number,
  postId: string,
  channelId: string,
  threadRefId: string | null,
  opts: Partial<PostForThread> = {}
): PostForThread {
  return {
    id,
    postId,
    platform: "discord",
    channelId,
    threadRefId,
    createdAt: new Date(2024, 0, 1, 0, 0, id),
    ...opts,
  };
}

function run() {
  const ch = "chan-1";

  // Two top-level messages + one reply → two trees (not one channel mega-thread)
  const a = dPost(1, "m-a", ch, null);
  const b = dPost(2, "m-b", ch, null);
  const c = dPost(3, "m-c", ch, "m-a");
  let threads = buildDiscordReplyForestThreads([a, b, c]);
  assert.equal(threads.length, 2);
  const byRoot = new Map(threads.map((t) => [t.rootPost.postId, t]));
  assert.deepEqual(
    byRoot.get("m-a")!.replies.map((r) => r.postId),
    ["m-c"]
  );
  assert.equal(byRoot.get("m-b")!.replies.length, 0);

  // Linear chain
  const p1 = dPost(10, "t1", ch, null);
  const p2 = dPost(11, "t2", ch, "t1");
  const p3 = dPost(12, "t3", ch, "t2");
  threads = buildDiscordReplyForestThreads([p1, p2, p3]);
  assert.equal(threads.length, 1);
  assert.deepEqual(
    threads[0].replies.map((r) => r.postId),
    ["t2", "t3"]
  );

  // Fork: two children of same parent
  const r0 = dPost(20, "r0", ch, null);
  const r1 = dPost(21, "r1", ch, "r0", { createdAt: new Date(2024, 0, 2) });
  const r2 = dPost(22, "r2", ch, "r0", { createdAt: new Date(2024, 0, 3) });
  threads = buildDiscordReplyForestThreads([r0, r2, r1]);
  assert.equal(threads.length, 1);
  assert.deepEqual(
    threads[0].replies.map((r) => r.postId),
    ["r1", "r2"]
  );

  // Orphan reply: parent not in partition → root
  const orphan = dPost(30, "o1", ch, "missing-parent");
  threads = buildDiscordReplyForestThreads([orphan]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].rootPost.postId, "o1");
  assert.equal(threads[0].replies.length, 0);

  // Partition by job_id: same channel, two jobs → two separate one-post threads
  const j1 = dPost(40, "a1", ch, null, { job_id: "job-1" });
  const j2 = dPost(41, "a2", ch, null, { job_id: "job-2" });
  threads = buildDiscordReplyForestThreads([j1, j2]);
  assert.equal(threads.length, 2);

  // Cycle A→B→A: canonical root is min post id
  const ca = dPost(50, "100", ch, "200");
  const cb = dPost(51, "200", ch, "100");
  const postById = new Map<string, PostForThread>([
    ["100", ca],
    ["200", cb],
  ]);
  const canon = findDiscordPartitionRoot(ca, postById);
  assert.equal(canon.postId, "100");
  threads = buildDiscordReplyForestThreads([ca, cb]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].rootPost.postId, "100");
  assert.equal(threads[0].replies.length, 1);

  console.log("conversation-builder Discord tests passed");
}

run();
