-- Create unique index on Post(project_id, platform, postId)
CREATE UNIQUE INDEX IF NOT EXISTS "Post_project_id_platform_postId_key" ON "Post"("project_id", "platform", "postId");

