/**
 * High-confidence advertorial lead-in patterns: native ads, affiliate SEO, sponsored blog, vendor marketing.
 * Used to filter out potential blog/ad content by title before analysis (pipeline + reevaluate script).
 */

/** Substring patterns (case-insensitive). Title is normalized to lowercase for matching. */
const ADVERTORIAL_LEAD_INS: string[] = [
  // Instructional + outcome promise (avoid bare "how to" to not flag legit how-to journalism)
  "how to finally ",
  "how to quickly ",
  "how to start using ",
  "how to get better results with",
  "how to improve your ",
  "how to save money on",
  "how to upgrade your ",
  "how to optimize your ",
  "how to get your ",
  "how to get ",
  // Insider / hidden knowledge
  "what most people don't know about",
  "what experts recommend for",
  "what professionals use to",
  "what you should know before",
  "what companies are switching to",
  "what successful teams use",
  "what smart buyers consider before",
  "what industry leaders are doing differently",
  // Authority borrowing
  "experts say this is the best way to",
  "doctors recommend this for",
  "analysts predict this will change",
  "researchers discovered a new way to",
  "according to industry experts",
  "a growing number of companies are adopting",
  // Optimization / replacement
  "a better way to manage",
  "a smarter way to handle",
  "the modern way to ",
  "the new standard for",
  "the alternative to traditional",
  "the future of ",
  "the next generation of",
  "the evolution of",
  // Pain → relief
  "struggling with ",
  "tired of dealing with",
  "if you're still using ",
  "still relying on ",
  "facing challenges with",
  "many businesses struggle with",
  // Comparative soft sell
  "why businesses are moving away from",
  "why more teams are choosing",
  "why companies are turning to",
  "why traditional solutions fall short",
  "why this approach is gaining traction",
  // Low-friction discovery
  "you may want to consider",
  "it might be time to rethink",
  "here's an option worth exploring",
  "one solution gaining popularity",
  "an approach worth looking into",
  // Listicles with implied conversion
  " tools that help you",
  " solutions for modern teams",
  " platforms to improve",
  " ways to streamline",
  " strategies to boost",
  " services designed to",
  // Time / urgency commercial hooks
  "in today's fast-paced world",
  "as businesses scale",
  "with rising costs",
  "as digital transformation accelerates",
  "in an increasingly competitive landscape",
];

/**
 * Returns true if the title matches high-confidence advertorial lead-in patterns
 * (instructional+outcome, insider framing, authority borrowing, optimization, pain-relief, etc.).
 */
export function isLikelyAdvertorialTitle(title: string | null | undefined): boolean {
  if (title == null || typeof title !== "string") return false;
  const t = title.trim().toLowerCase();
  if (!t) return false;
  return ADVERTORIAL_LEAD_INS.some((phrase) => t.includes(phrase));
}
