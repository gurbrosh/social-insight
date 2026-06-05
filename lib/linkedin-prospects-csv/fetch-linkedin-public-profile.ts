import { parseCompanyFromHeadline } from "./row-text";

/**
 * Best-effort fetch of a public /in/ profile page. LinkedIn often returns an auth wall;
 * in that case we return `null` and the caller should fall back to ingest (Post.extraJson).
 */
export type LinkedInPublicProfileScrape = {
  first_name: string;
  last_name: string;
  /** Role / headline line */
  title: string;
  company: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function tryFetchLinkedInPublicProfileData(
  profileUrl: string
): Promise<LinkedInPublicProfileScrape | null> {
  const u = profileUrl.trim();
  if (!/^https?:\/\//i.test(u)) return null;

  try {
    const res = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 2_000 && /authwall|consent|challenge|login|checkpoint/gi.test(html)) {
      return null;
    }

    const companyFromExperience = tryExtractTopExperienceCompany(html);

    const metaContent = (prop: string): string | null => {
      const a = html.match(
        new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, "i")
      )?.[1];
      if (a) return decodeHtmlEntity(a);
      const b = html.match(
        new RegExp(`<meta\\s+content="([^"]*)"\\s+property="${prop}"`, "i")
      )?.[1];
      return b ? decodeHtmlEntity(b) : null;
    };

    const ogTitle = metaContent("og:title");
    if (!ogTitle) return null;

    const namePart = ogTitle.split("|")[0]?.trim() ?? ogTitle;
    if (/linkedin/i.test(namePart) && namePart.length < 3) return null;

    const sub = namePart
      .replace(/\s+-\s+LinkedIn\s*$/i, "")
      .replace(/\s+\|\s+LinkedIn\s*$/i, "")
      .trim();

    const atCo = sub.match(/^(.*?)\s+at\s+(.+)$/i);
    if (atCo) {
      const left = (atCo[1] ?? "").trim();
      const companyFromLine = (atCo[2] ?? "").trim();
      const nameBits = left.split(/\s+/).filter(Boolean);
      return {
        first_name: nameBits[0] ?? "",
        last_name: nameBits.slice(1).join(" "),
        title: sub,
        company: companyFromExperience || companyFromLine,
      };
    }

    const dashParts = sub.split(/\s+-\s+/);
    if (dashParts.length >= 2) {
      const nameStr = (dashParts[0] ?? "").trim();
      const rest = dashParts.slice(1).join(" - ").trim();
      const nameBits = nameStr.split(/\s+/).filter(Boolean);
      const fromHead = parseCompanyFromHeadline(rest);
      return {
        first_name: nameBits[0] ?? "",
        last_name: nameBits.slice(1).join(" "),
        title: rest,
        company: companyFromExperience || fromHead,
      };
    }

    const bits = sub.split(/\s+/).filter(Boolean);
    if (bits.length === 0) return null;
    return {
      first_name: bits[0] ?? "",
      last_name: bits.slice(1).join(" "),
      title: "",
      company: companyFromExperience,
    };
  } catch {
    return null;
  }
}

function decodeHtmlEntity(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Most recent (top) Experience company: JSON-LD `worksFor`, else first embedded
 * `companyName.text` after an Experience/position marker (best-effort; HTML changes often).
 */
function tryExtractTopExperienceCompany(html: string): string {
  const fromLd = tryCompanyFromJsonLdPerson(html);
  if (fromLd) return fromLd;
  const m = /profilePosition|fsd_profilePosition|PositionGroup|"EXPERIENCE"/i.exec(html);
  const start = m?.index != null ? m.index : 0;
  const win = html.slice(start, start + 250_000);
  const hit = /"companyName"\s*:\s*\{[^}]*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(
    win
  );
  if (hit?.[1]) {
    const s = unescapeJsonStr(hit[1]);
    if (s && s.length < 200 && !/^LinkedIn$/i.test(s) && !/^https?:/i.test(s)) {
      return s;
    }
  }
  return "";
}

function unescapeJsonStr(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\u0026/g, "&").trim();
}

function tryCompanyFromJsonLdPerson(html: string): string {
  for (const m of html.matchAll(
    /<script type="application\/ld\+json">([^<]+)<\/script>/gi
  )) {
    try {
      const j = JSON.parse(m[1].trim()) as unknown;
      const list = Array.isArray(j) ? j : [j];
      for (const o of list) {
        if (!o || typeof o !== "object") continue;
        if ((o as { "@type"?: string })["@type"] !== "Person") continue;
        const w = (o as { worksFor?: unknown }).worksFor;
        if (w) {
          const wf = Array.isArray(w) ? w[0] : w;
          if (wf && typeof wf === "object" && (wf as { name?: string }).name) {
            const n = String((wf as { name: string }).name).trim();
            if (n) return n;
          }
        }
      }
    } catch {
      /* */
    }
  }
  return "";
}
