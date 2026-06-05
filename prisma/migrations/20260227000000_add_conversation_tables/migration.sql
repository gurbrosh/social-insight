-- AlterTable: Add post_conversation_role and conversation_id to Post
ALTER TABLE "Post" ADD COLUMN "post_conversation_role" TEXT;
ALTER TABLE "Post" ADD COLUMN "conversation_id" TEXT;

CREATE INDEX "Post_conversation_id_idx" ON "Post"("conversation_id");
CREATE INDEX "Post_post_conversation_role_idx" ON "Post"("post_conversation_role");

-- CreateTable: Conversation
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "project_id" TEXT NOT NULL,
    "root_post_id" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    CONSTRAINT "Conversation_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_root_post_id_fkey" FOREIGN KEY ("root_post_id") REFERENCES "Post" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Conversation_project_id_root_post_id_key" ON "Conversation"("project_id", "root_post_id");
CREATE INDEX "Conversation_project_id_deleted_at_idx" ON "Conversation"("project_id", "deleted_at");
CREATE INDEX "Conversation_root_post_id_idx" ON "Conversation"("root_post_id");
CREATE INDEX "Conversation_deleted_at_idx" ON "Conversation"("deleted_at");

-- CreateTable: ConversationNode
CREATE TABLE "ConversationNode" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "conversation_id" TEXT NOT NULL,
    "post_id" INTEGER NOT NULL,
    "parent_node_id" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ConversationNode_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConversationNode_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "Post" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConversationNode_parent_node_id_fkey" FOREIGN KEY ("parent_node_id") REFERENCES "ConversationNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ConversationNode_conversation_id_deleted_at_idx" ON "ConversationNode"("conversation_id", "deleted_at");
CREATE INDEX "ConversationNode_post_id_idx" ON "ConversationNode"("post_id");
CREATE INDEX "ConversationNode_deleted_at_idx" ON "ConversationNode"("deleted_at");
