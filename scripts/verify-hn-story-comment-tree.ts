/**
 * Sanity check for HN comment thread ranking (no network).
 * Run: npm run verify:hn-tree
 */

import assert from "node:assert/strict";
import { rankTopLevelThreads } from "../lib/hackernews/story-comment-tree";
import type { HnFirebaseItem } from "../lib/hackernews/types";

function c(
  id: number,
  kids: number[] | undefined,
  text = "Substantive comment text for length."
): HnFirebaseItem {
  return {
    id,
    type: "comment",
    text: `<p>${text}</p>`,
    kids,
    deleted: false,
    dead: false,
  };
}

const byId = new Map<number, HnFirebaseItem>();
// Thread A: root 10 -> 11 -> 12 (3 nodes)
byId.set(10, c(10, [11]));
byId.set(11, c(11, [12]));
byId.set(12, c(12, undefined));
// Thread B: root 20 alone (1 node)
byId.set(20, c(20, undefined));

const ranked = rankTopLevelThreads([20, 10], byId);
assert.equal(ranked.length, 2);
assert.equal(ranked[0].rootId, 10);
assert.equal(ranked[0].size, 3);
assert.equal(ranked[1].rootId, 20);
assert.equal(ranked[1].size, 1);

console.log("verify-hn-story-comment-tree: ok");
