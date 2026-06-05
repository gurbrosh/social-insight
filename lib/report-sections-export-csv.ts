import type { InfluentialPerson } from "@/lib/network-analysis";
import type { ChatterConversation } from "@/app/actions/chatter-analysis";
import { escapeCsvCell } from "@/lib/themes-export-csv";

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

export function buildInfluencersCsvContent(people: InfluentialPerson[]): string {
  const headers = [
    "Platform",
    "Author Name",
    "Author ID",
    "Profile URL",
    "Post Count",
    "Total Reactions",
    "Total Likes",
    "Total Comments",
    "Total Shares",
    "Discord Server",
    "Ideas",
  ];
  const rows = people.map((p) => {
    const ideasStr = Array.isArray(p.ideas) ? p.ideas.join(" | ") : "";
    return [
      escapeCsvCell(p.platform),
      escapeCsvCell(p.authorName),
      escapeCsvCell(p.authorId),
      escapeCsvCell(p.profileUrl || ""),
      String(p.postCount ?? ""),
      String(p.totalReactions ?? ""),
      String(p.totalLikes ?? ""),
      String(p.totalComments ?? ""),
      String(p.totalShares ?? ""),
      escapeCsvCell(p.discordServerName || ""),
      escapeCsvCell(ideasStr),
    ].join(",");
  });
  return joinLines([headers.join(","), ...rows]);
}

type PostNewsRow = {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  sentiment: string | null;
  importance_score: number | null;
  source_url: string | null;
  date_range_start: Date | null;
  date_range_end: Date | null;
  created_at: Date;
  sources: string | null;
};

export function buildNewsCsvContent(items: PostNewsRow[]): string {
  const headers = [
    "Title",
    "Summary",
    "Content",
    "Sentiment",
    "Importance Score",
    "Source URL",
    "Date Range Start",
    "Date Range End",
    "Created At",
    "Sources (JSON)",
  ];
  const rows = items.map((n) =>
    [
      escapeCsvCell(n.title),
      escapeCsvCell(n.summary || ""),
      escapeCsvCell(n.content || ""),
      escapeCsvCell(n.sentiment || ""),
      n.importance_score != null ? String(n.importance_score) : "",
      escapeCsvCell(n.source_url || ""),
      n.date_range_start ? escapeCsvCell(n.date_range_start.toISOString()) : "",
      n.date_range_end ? escapeCsvCell(n.date_range_end.toISOString()) : "",
      escapeCsvCell(n.created_at.toISOString()),
      escapeCsvCell(n.sources || ""),
    ].join(",")
  );
  return joinLines([headers.join(","), ...rows]);
}

export function buildChatterCsvContent(conversations: ChatterConversation[]): string {
  const headers = [
    "Discussion Title",
    "Topic Category",
    "Summary",
    "Sentiment",
    "Platforms",
    "Participant Count",
    "Total Messages",
    "Total Engagement",
    "First Post At",
    "Last Post At",
    "Link URL",
    "Discord Server",
    "Discord Channel",
    "Importance Score",
  ];
  const rows = conversations.map((c) => {
    const platformsStr = Array.isArray(c.platforms) ? c.platforms.join(" | ") : "";
    return [
      escapeCsvCell(c.discussion_title),
      escapeCsvCell(c.topic_category || ""),
      escapeCsvCell(c.summary || ""),
      escapeCsvCell(c.sentiment || ""),
      escapeCsvCell(platformsStr),
      String(c.participant_count ?? ""),
      String(c.total_messages ?? ""),
      String(c.total_engagement ?? ""),
      c.first_post_at ? escapeCsvCell(c.first_post_at.toISOString()) : "",
      c.last_post_at ? escapeCsvCell(c.last_post_at.toISOString()) : "",
      escapeCsvCell(c.link_url || ""),
      escapeCsvCell(c.discord_server || ""),
      escapeCsvCell(c.discord_channel || ""),
      c.importance_score != null ? String(c.importance_score) : "",
    ].join(",");
  });
  return joinLines([headers.join(","), ...rows]);
}
