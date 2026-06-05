import type { ProspectClassification } from "./types";

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function blob(args: {
  headline: string;
  currentTitle?: string | null;
}): string {
  return norm(`${args.currentTitle ?? ""} ${args.headline}`).toLowerCase();
}

function rcHas(
  rc: ProspectClassification["roleCategories"],
  ...keys: ProspectClassification["roleCategories"][number][]
): boolean {
  return keys.some((k) => rc.includes(k));
}

function ftHas(ft: ProspectClassification["functionTags"], ...keys: string[]): boolean {
  return keys.some((k) => ft.includes(k as ProspectClassification["functionTags"][number]));
}

function hasCybersecurityCue(b: string): boolean {
  return /\b(cyber\s*sec(?:urity)?|cyber\s+security|cybersecurity|infosec)\b/.test(b);
}

const PROFESSIONAL_ROLE_CUE_RE =
  /\b(developer|engineer|architect|analyst|scientist|designer|consultant|advis(?:or|er)|manager|director|specialist|coordinator|administrator|officer|founder|co[- ]?founder|ceo|cto|ciso|coo|cmo|vp|principal|partner|president|recruiter|lecturer|professor|researcher|instructor|programmer|swe|sre|devops|devrel|tech\s+lead|team\s+lead|head\s+of|penetration\s+tester|red\s+team|tester)\b/i;

const PROFESSIONAL_DOMAIN_CUE_RE =
  /\b(ai|ml|machine\s+learning|software|cyber|security|infosec|penetration|offensive|cloud|data|platform|devsec|devops|sales|marketing|product|saas|b2b|grc|soc|appsec|identity|blockchain|web3|fintech|consulting|engineering|architecture|infrastructure|automation|agentic|agents?|kubernetes|terraform|aws|azure|gcp|laravel|shopify|react|node\.?js|payments|hr|finance|legal|nurse|clinical|healthcare|gtm|go[- ]?to[- ]?market|partnerships?|enterprise|customer|success|guide|executive|student|vision|halcon|industrial)\b/i;

/** Short or minimal headlines that still describe a professional role (not thread-level junk). */
const EXPLICIT_SAFE_REFERENCE_HEADLINE_RE =
  /\b(gtm|go[- ]?to[- ]?market|account\s+executive|success\s+guide|customer\s+success|partnerships?|enterprise\s+(browser|account|sales)|student\s+at|it\s+security|machine\s+vision|smart\s+factory|associate\s+technology|technology\s+associate|cyber\s+risk|senior\s+officer|industrial\s+automation|vision\s+system|halcon)\b/i;

export function headlineSupportsExplicitSafeReference(headline: string): boolean {
  const t = headline.replace(/\s+/g, " ").trim();
  if (!t || t.length < 4) return false;
  if (EXPLICIT_SAFE_REFERENCE_HEADLINE_RE.test(t)) return true;
  if (/@/.test(t) && /\b(guide|executive|engineer|manager|specialist|associate)\b/i.test(t)) {
    return true;
  }
  if (/\bat\s+[A-Za-z]/i.test(t) && /\b(leadership|executive|guide|associate|manager|technology)\b/i.test(t)) {
    return true;
  }
  if (PROFESSIONAL_ROLE_CUE_RE.test(t) || PROFESSIONAL_DOMAIN_CUE_RE.test(t)) return true;
  return false;
}

const VAGUE_HEADLINE_SEGMENT_RE =
  /^(leadership|motivational|inspirational|mindset|growth|success|passion|purpose|believe|dream|hustle|grind|speaker|coach|mentor|visionary|thought\s+leader)$/i;

/**
 * Headlines that must not produce literal token-based safe references.
 * Use thread perspective fallback instead.
 */
export function isLowSignalHeadlineForSafeReference(headline: string): boolean {
  const t = headline.replace(/\s+/g, " ").trim();
  if (!t || t === "--" || t === "-" || t === "." || /^\*+$/.test(t)) return true;
  if (t.length < 4) return true;
  if (!/[a-z]/i.test(t)) return true;
  if (/^do you love tofu/i.test(t) || /\btofu\b/i.test(t)) return true;
  if (/^me too!*$/i.test(t)) return true;

  const hasRole = PROFESSIONAL_ROLE_CUE_RE.test(t);
  const hasDomain = PROFESSIONAL_DOMAIN_CUE_RE.test(t);
  if (hasRole || hasDomain) return false;

  if (headlineSupportsExplicitSafeReference(t)) return false;

  if (
    /^(slowing\s+down|starting\s+to\s+read|read\s+the\s+code|just\s+vibes|humbled\s+and\s+honored|excited\s+to\s+share)/i.test(
      t
    )
  ) {
    return true;
  }

  if (/!$/.test(t) && t.length < 100) return true;

  const segments = t
    .split(/\s*[|·•/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length > 0 && segments.length <= 3) {
    const allVague = segments.every(
      (seg) =>
        VAGUE_HEADLINE_SEGMENT_RE.test(seg.trim()) ||
        (seg.length < 32 && !PROFESSIONAL_ROLE_CUE_RE.test(seg) && !PROFESSIONAL_DOMAIN_CUE_RE.test(seg))
    );
    if (allVague) return true;
  }

  if (t.length < 55) return true;

  return false;
}

/** Reject literal "your … work" phrases built from non-professional junk tokens. */
export function isAwkwardLiteralSafeReference(ref: string | null | undefined): boolean {
  if (!ref?.trim()) return false;
  const m = ref.trim().match(/^your (.+) work$/i);
  if (!m) return false;
  const domain = m[1]!.toLowerCase();
  if (/\b(attended|student\s+at)\b/.test(domain)) return true;
  if (
    /\bproduct\b/.test(domain) &&
    !/\b(product\s+management|product\s+leader|product\s+manager|product\s+work)\b/.test(domain)
  ) {
    return true;
  }
  if (/\bsponsor\s+finance\b/.test(domain) && domain.split(/\s+/).length > 4) return true;
  if (/\bmarketplaces?\s+manager\b/.test(domain) && domain.split(/\s+/).length > 3) return true;
  if (
    /^\s*(build|building|helping|driving|securing|executive\s+director)\b/.test(domain) &&
    domain.split(/\s+/).length > 4
  ) {
    return true;
  }
  const wordCount = domain.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 6) return true;
  if (
    wordCount >= 4 &&
    /\b(networks|openai|salesforce|servicenow|barracuda|palo|alto|protecting|healthcare|advisors?|industrial|energy)\b/.test(
      domain
    )
  ) {
    return true;
  }
  if (/\bdirector\b/.test(domain) && /\b(cyber|risk|resilience)\b/.test(domain) && wordCount >= 4) {
    return true;
  }
  if (/^senior\s+officer$/i.test(domain.trim()) || /^president\s+advisors?$/i.test(domain.trim())) {
    return true;
  }
  if (PROFESSIONAL_ROLE_CUE_RE.test(domain) || PROFESSIONAL_DOMAIN_CUE_RE.test(domain)) {
    return false;
  }
  return true;
}

/**
 * Natural safe-reference phrases from clear headline cues (runs before low-signal and token-soup paths).
 */
function explicitSafeReferenceFromHeadline(
  b: string,
  rc: ProspectClassification["roleCategories"],
  ft: ProspectClassification["functionTags"]
): string | null {
  if (/\bgtm\b/.test(b) && /\bleadership\b/.test(b)) {
    return "your GTM leadership work";
  }
  if ((/^\s*gtm\b/.test(b) || /\bgtm\s*[-–—]\s*\w/.test(b)) && b.split(/\s+/).length <= 8) {
    return "your GTM work";
  }
  if (/\bsuccess\s+guide\b/.test(b)) {
    return "your customer success work";
  }
  if (/\bgtm\b/.test(b) && /\bpartnerships?\b/.test(b)) {
    return "your GTM and partnerships work";
  }
  if (/\baccount\s+executive\b/.test(b)) {
    return "your enterprise sales work";
  }
  if (/\bproduct\s+builder\b/.test(b)) {
    return "your product-building work";
  }
  if (/\b(senior\s+)?associate\s+technology\b/.test(b)) {
    return "your technology consulting work";
  }
  if (
    /\bmachine\s+vision\b/.test(b) &&
    (/\bautomation\b|\bsmart\s+factory\b|\bhalcon\b|\bindustrial\b|\bvision\s+system\b/.test(b))
  ) {
    return "your industrial automation and machine vision work";
  }
  if (/\bstudent\s+at\b/.test(b)) {
    return "your engineering studies";
  }
  if (/\bit\s+security\b/.test(b)) {
    return "your IT security work";
  }
  if (/\bcyber\s+risk\b/.test(b) && /\bresilience\b/.test(b)) {
    return "your cyber risk and resilience leadership";
  }
  if (/\bhealthcare\b/.test(b) && /\b(security|palo|networks)\b/.test(b)) {
    return "your healthcare security work";
  }
  if (/\bsenior\s+officer\b/.test(b) && !/\bcyber\s+risk\b/.test(b)) {
    return "your executive leadership work";
  }
  if (/\bpresident\b/.test(b) && /\badvisors?\b/.test(b)) {
    return "your advisory leadership work";
  }
  if (rcHas(rc, "customer_success_leader", "customer_success") || ftHas(ft, "customer_success")) {
    if (/\b(success|customer)\b/.test(b)) return "your customer success work";
  }
  if (rcHas(rc, "sales_account", "sales_leader") && /\b(account|executive|sales)\b/.test(b)) {
    return "your enterprise sales work";
  }
  if (rcHas(rc, "student") && (/\bstudent\b/.test(b) || /\b(engineering|engineer)\b/.test(b))) {
    return "your engineering studies";
  }
  return null;
}

export function resolveExplicitSafeProfessionalReference(args: {
  headline: string;
  currentTitle?: string | null;
  roleCategories?: ProspectClassification["roleCategories"];
  functionTags?: ProspectClassification["functionTags"];
}): string | null {
  const b = blob({ headline: args.headline, currentTitle: args.currentTitle });
  if (b.length < 4) return null;
  return explicitSafeReferenceFromHeadline(
    b,
    args.roleCategories ?? ["unknown"],
    args.functionTags ?? ["unknown"]
  );
}

/** Most-specific headline/role cues — evaluated before broad security/founder fallbacks. */
function prioritySpecificReference(
  b: string,
  rc: ProspectClassification["roleCategories"],
  ft: ProspectClassification["functionTags"]
): string | null {
  const explicit = explicitSafeReferenceFromHeadline(b, rc, ft);
  if (explicit) return explicit;

  if (/\bvp\b/.test(b) && /\b(r&d|research\s+and\s+development)\b/.test(b)) {
    return "your R&D and engineering leadership";
  }

  if (
    /\bindustry\s+analyst\b/.test(b) &&
    /\bapplication\s+security\b/.test(b) &&
    rcHas(rc, "analyst_security", "security_practitioner")
  ) {
    return "your application security analyst work";
  }

  if (
    /\bsecurity\s+engineer\b/.test(b) &&
    /\b(rsac|defcon|bsides|speaker|blogger|podcast)\b/.test(b)
  ) {
    return "your security engineering and security community work";
  }

  if (
    /\b(owner|co[- ]?founder|cofounder)\b/.test(b) &&
    /\b(cyber\s*security|cybersecurity)\b/.test(b) &&
    /\b(tribe|community)\b/.test(b)
  ) {
    return "your cybersecurity founder and community work";
  }

  if (
    /\b(co[- ]?founder|cofounder)\b/.test(b) &&
    /\bcto\b/.test(b) &&
    /\b(cybersecurity|cyber\s+security|infosec|grc)\b/.test(b) &&
    /\bai\b/.test(b)
  ) {
    return "your AI cybersecurity founder and engineering work";
  }

  if (
    /\bco[- ]?founder\s*&\s*cto\b/.test(b) &&
    /\b(cyber\s*sec|cybersecurity|infosec|ai)\b/.test(b)
  ) {
    return "your AI cybersecurity founder and engineering work";
  }

  if (/\bhead\s+of\s+security\b/.test(b) && !/\bgrc\b/.test(b)) {
    return "your security leadership work";
  }

  if (
    rcHas(rc, "executive_assistant", "operations_support") &&
    /\bexecutive\s+assistant\b/.test(b)
  ) {
    return "your executive support and operations work";
  }

  if (
    rcHas(rc, "designer", "marketing_consultant") &&
    /\b(social\s+media|high[-\s]?converting)\b/.test(b) &&
    /\bdesign\b/.test(b)
  ) {
    return "your social media design work";
  }

  if (
    (/\bco[- ]?founder\b/.test(b) || /\bcro\b/.test(b)) &&
    /\bpresales\b/.test(b) &&
    (/\brevenue\b/.test(b) || /\bgtm\b/.test(b) || rcHas(rc, "revenue_leader", "gtm_leader"))
  ) {
    return "your presales and revenue leadership";
  }

  if (
    (rcHas(rc, "founder", "solo_founder") || /\bfounder\b/.test(b)) &&
    hasCybersecurityCue(b) &&
    /\b(ai|architect|architecture|principal)\b/.test(b)
  ) {
    return "your AI cybersecurity founder and architecture work";
  }

  if (
    /\bowasp\b/.test(b) &&
    (/\bph\.?\s*d\b/.test(b) || /\bresearch\b/.test(b) || /\bproject\s+lead\b/.test(b)) &&
    !/\bfounder\b/.test(b)
  ) {
    return "your OWASP AI security research work";
  }

  if (
    /\bai[-\s]?augmented\b/.test(b) &&
    (/\barchitect\b/.test(b) || /\bsoftware\s+engineer\b/.test(b))
  ) {
    return "your AI-augmented software architecture work";
  }

  if (
    /\bexecutive\s+support\b/.test(b) &&
    (/\binfrastructure\b/.test(b) || /\bexecution\b/.test(b))
  ) {
    return "your executive support infrastructure work";
  }

  if (
    /\b(founder|principal)\b/.test(b) &&
    /\bexecutive\s+support\b/.test(b) &&
    /\b(infrastructure|execution)\b/.test(b)
  ) {
    return "your executive support infrastructure work";
  }

  if (
    /\bsecurity\s+engineer\b/.test(b) &&
    /\b(detection\s*&?\s*response|detection\s+and\s+response)\b/.test(b)
  ) {
    return "your detection and response engineering work";
  }

  if (
    /\bai\s+engineer\b/.test(b) &&
    (/\bopen\s+source\b/.test(b) || /\bsoftware\s+engineer\b/.test(b)) &&
    (/\bms\s*cs\b/.test(b) || rcHas(rc, "software_engineer", "student"))
  ) {
    return "your AI and software engineering work";
  }

  if (
    /\bfounder\s+at\b/.test(b) &&
    /\b(identity|iam|access\s+management|zero\s+trust)\b/.test(b)
  ) {
    return "your identity and security founder perspective";
  }

  if (
    (/\bvp\b/.test(b) || rcHas(rc, "sales_leader", "revenue_leader")) &&
    /\b(ai\s+security|security\s+sales)\b/.test(b) &&
    /\b(sales|gtm|revenue)\b/.test(b)
  ) {
    return "your AI security sales leadership";
  }

  if (
    rcHas(rc, "founder", "solo_founder") &&
    /\bprincipal\s+architect\b/.test(b) &&
    /\b(cyber\s*sec|cybersecurity)\b/.test(b) &&
    /\bai\b/.test(b)
  ) {
    return "your AI cybersecurity founder and architecture work";
  }

  if (
    /\b(chief\s+innovation|innovation\s+(?:&|and)\s+security)\b/.test(b) &&
    /\b(cyber\s*sec|cybersecurity)\b/.test(b) &&
    /\bai\b/.test(b)
  ) {
    return "your AI-powered cybersecurity leadership";
  }

  if (/\bdeveloper\s+security\b/.test(b) || /\bdev\s*sec\b/.test(b)) {
    return "your developer security work";
  }

  if (
    /\bdecentralized\b/.test(b) &&
    (/\bdepin\b/.test(b) || /\bai\b/.test(b) || /\bsystems?\s+engineer\b/.test(b))
  ) {
    return "your decentralized AI systems engineering work";
  }

  if (
    /\bsoftware\s+engineer\b/.test(b) &&
    (/\bai\s+innovator\b/.test(b) || (/\bai\b/.test(b) && /\binnovator\b/.test(b)))
  ) {
    return "your AI software engineering work";
  }

  if (
    /\b(engineering|engineer)\b/.test(b) &&
    /\bdata\b/.test(b) &&
    /\bai\b/.test(b) &&
    /\bplatforms?\b/.test(b)
  ) {
    return "your data and AI platform engineering work";
  }

  if (/\bcyber\s*security\s+analyst\b/.test(b) || /\bsecurity\s+analyst\b/.test(b)) {
    return "your cyber security analysis work";
  }

  if (
    /\bpractice\s+manager\b/.test(b) &&
    /\bsecurity\s+consulting\b/.test(b) &&
    /\b(advisory|advisory\s+services)\b/.test(b)
  ) {
    return "your security consulting and advisory work";
  }

  if (
    (rcHas(rc, "founder", "solo_founder") || /\bfounder\b/.test(b)) &&
    /\b(vishing|smishing|quishing|human\s+cyber|security\s+awareness)\b/.test(b)
  ) {
    return "your AI-driven security awareness founder work";
  }

  if (
    /\b(senior\s+)?developer\b/.test(b) &&
    /\bteam\s+leader\b/.test(b) &&
    /\bbi\b/.test(b)
  ) {
    return "your BI development and engineering leadership";
  }

  if (
    (/\bfounder\b/.test(b) || rcHas(rc, "founder")) &&
    /\b(lead\s+developer|automation\s+engineer)\b/.test(b) &&
    /\bai\b/.test(b) &&
    /\bautomation\b/.test(b)
  ) {
    return "your AI automation founder and engineering work";
  }

  if (rcHas(rc, "revenue_leader", "executive_leader") && /\b(cro|chief\s+revenue)\b/.test(b)) {
    if (/\bretired\b/.test(b)) return "your revenue leadership background";
    return "your revenue and commercial leadership";
  }

  if (
    (rcHas(rc, "investor", "advisor") || /\bangel\s+investor\b/.test(b)) &&
    /\b(board\s+member|mentor|advisor)\b/.test(b)
  ) {
    return "your investing and advisory work";
  }

  if (/\b(it\s+auditor|staff\s+it\s+auditor)\b/.test(b)) {
    return "your IT audit and information security work";
  }

  if (
    (rcHas(rc, "coach_or_advisor", "consultant") || /\bcoach\b/.test(b)) &&
    /\b(leadership\s+career\s+coach|leadership\s+coach|career\s+coach)\b/.test(b) &&
    /\b(speaker|author|mentor)\b/.test(b)
  ) {
    return "your leadership coaching work";
  }

  if (rcHas(rc, "partnerships_leader") && /\b(svp|alliances?|partnerships?)\b/.test(b)) {
    return "your global alliances leadership";
  }

  if (rcHas(rc, "student") && /\b(engineering|engineer)\b/.test(b)) {
    return "your engineering studies";
  }

  if (rcHas(rc, "finance_accounting", "executive_leader") && /\bsponsor\s+finance\b/.test(b)) {
    return "your sponsor finance leadership";
  }

  if (
    (rcHas(rc, "product_manager", "product_leader") || /\bproduct\s+management\b/.test(b)) &&
    /\bproduct\b/.test(b) &&
    (/\bat\b|@/.test(b) || /\bproduct\s+at\b/.test(b))
  ) {
    return "your product work";
  }

  if (rcHas(rc, "hr_leader", "recruiter", "people_leader")) {
    return "your HR and talent leadership work";
  }

  if (rcHas(rc, "customer_success_leader", "account_management")) {
    return "your customer success work";
  }

  if (rcHas(rc, "operations_leader") && /\bmarketplace\b/.test(b)) {
    return "your marketplace management work";
  }

  if (ftHas(ft, "power_bi", "business_intelligence") && rcHas(rc, "engineering_leader")) {
    return "your BI development and engineering leadership";
  }

  return null;
}

function securityDomainReference(b: string): string | null {
  if (
    /\b(co[- ]?founder|cofounder)\b/.test(b) &&
    /\bcto\b/.test(b) &&
    /\b(cybersecurity|infosec)\b/.test(b) &&
    /\bai\b/.test(b)
  ) {
    return "your AI cybersecurity founder and engineering work";
  }

  if (
    /\b(ai\s+security|agent\s+security|aspm|agentic\s+security)\b/.test(b) &&
    !/\b(founder|co[- ]?founder)\b/.test(b)
  ) {
    return "your AI security work";
  }
  if (/\b(application\s+security|appsec|code\s+security|static\s+analysis)\b/.test(b)) {
    return "your application security work";
  }
  if (/\b(soc\s+analyst|security\s+operations|secops|autonomous\s+secops)\b/.test(b)) {
    return "your security operations work";
  }
  if (/\b(dfir|incident\s+response|threat\s+hunt|threat\s+intelligence)\b/.test(b)) {
    return "your incident response and DFIR work";
  }
  if (
    /\bgrc\b/.test(b) &&
    /\b(ciso|director|head\s+of|leader|manager|governance)\b/.test(b) &&
    !/\bhead\s+of\s+security\b/.test(b)
  ) {
    return "your GRC and security leadership work";
  }
  if (
    /\b(ciso|chief\s+information\s+security|vciso)\b/.test(b) &&
    !/\bhead\s+of\s+security\b/.test(b) &&
    !/\bsecurity\s+engineer\b/.test(b)
  ) {
    if (/\b(infrastructure|cloud|platform)\b/.test(b)) {
      return "your information security and infrastructure leadership";
    }
    return "your information security leadership";
  }
  if (/\b(identity|iam|zero\s+trust)\b/.test(b) && /\b(secur|access)\b/.test(b)) {
    return "your identity security work";
  }
  if (/\bproduct\s+security\b/.test(b)) {
    return "your product security engineering work";
  }
  if (/\b(network\s+and\s+system\s+security|cloud\s+security)\b/.test(b)) {
    return "your network and cloud security work";
  }
  if (/\b(penetration\s+test|offensive\s+security|red\s+team)\b/.test(b)) {
    return "your offensive security work";
  }
  if (/\b(sase|secure\s+access\s+service\s+edge)\b/.test(b) && /\b(security\s+engineer|soc|edr|xdr|pam|dlp)\b/.test(b)) {
    return "your SASE and security engineering work";
  }
  if (/\b(cyber\s+defense|cybersecurity)\b/.test(b) && /\b(engineer|engineering)\b/.test(b)) {
    return "your cyber defense engineering work";
  }
  return null;
}

function leadershipAndPlatformReference(
  b: string,
  rc: ProspectClassification["roleCategories"],
  ft: ProspectClassification["functionTags"]
): string | null {
  if (
    /\b(secur|secure)\b/.test(b) &&
    /\bidentit(y|ies)\b/.test(b) &&
    (/\bat\s+scale\b/.test(b) || /\benterprises?\b/.test(b) || /\bhelping\b/.test(b))
  ) {
    return "your identity security work";
  }

  if (
    /\b(sr\.?|senior)?\s*platform\s+engineer\b/.test(b) &&
    /\b(aws|azure|gcp|terraform|kubernetes)\b/.test(b)
  ) {
    return "your cloud platform engineering work";
  }

  if (
    /\b(cyber\s*security|cybersecurity)\b/.test(b) &&
    /\b(bestselling\s+author|author)\b/.test(b) &&
    (/\badvisory\b/.test(b) || /\bboard\b/.test(b) || ftHas(ft, "education"))
  ) {
    return "your cybersecurity education and advisory work";
  }

  if (
    /\b(senior\s+)?director\b/.test(b) &&
    /\bsecurity\s+engineering\b/.test(b)
  ) {
    return "your security engineering leadership";
  }

  if (
    /\btech\s+lead\b/.test(b) &&
    /\bai\s+platforms?\b/.test(b) &&
    /\b(distributed\s+systems|product\s+engineering)\b/.test(b)
  ) {
    return "your AI platform and distributed systems leadership";
  }

  if (
    (rcHas(rc, "founder", "solo_founder") || /\bfounder\b/.test(b)) &&
    /\bceo\b/.test(b) &&
    /\bai\b/.test(b) &&
    /\b(technolog|systems?)\b/.test(b)
  ) {
    return "your AI systems founder perspective";
  }

  if (
    /\b(co[- ]?founder|cofounder)\b/.test(b) &&
    /\bcto\b/.test(b) &&
    /\b(cybersecurity|cyber\s+security|infosec)\b/.test(b) &&
    /\bai\b/.test(b)
  ) {
    return "your AI cybersecurity founder and engineering work";
  }

  if (
    (/\bfounding\s+ceo\b/.test(b) || (/\bfounder\b/.test(b) && /\bceo\b/.test(b))) &&
    /\bturnarounds?/i.test(b)
  ) {
    return "your founder and turnaround leadership";
  }

  if (/\blogistics\b/.test(b) && /\boperations\s+leader\b/.test(b)) {
    return "your logistics operations leadership";
  }

  if (
    /\bcareer\b/.test(b) &&
    /\b(leadership\s+)?strategist\b/.test(b) &&
    /\bgo[- ]?to[- ]?market\b/.test(b)
  ) {
    return "your career and go-to-market strategy work";
  }

  if (/\bsupplier\s+management\b/.test(b)) {
    return "your supplier management work";
  }

  if (
    rcHas(rc, "technical_lead", "engineering_leader") &&
    ftHas(ft, "ai_ml", "platform") &&
    /\bai\s+platforms?\b/.test(b)
  ) {
    return "your AI platform and distributed systems leadership";
  }

  return null;
}

/**
 * Compositional safe_professional_reference from headline domain cues + final labels.
 * Runs after role/category/function cleanup; avoids broad "your engineering work" fallbacks.
 */
export function composeSafeProfessionalReference(args: {
  headline: string;
  currentTitle?: string | null;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
}): string | null {
  const b = blob(args);
  const h = norm(args.headline);
  const rc = args.roleCategories;
  const ft = args.functionTags;

  if (b.length < 6) return null;

  const explicitRef = explicitSafeReferenceFromHeadline(b, rc, ft);
  if (explicitRef) return explicitRef;

  const priorityRef = prioritySpecificReference(b, rc, ft);
  if (priorityRef) return priorityRef;

  const securityRef = securityDomainReference(b);
  if (securityRef) return securityRef;

  const leadershipRef = leadershipAndPlatformReference(b, rc, ft);
  if (leadershipRef) return leadershipRef;

  if (
    /\bai\b/.test(b) &&
    /\b(content\s+creator|creator)\b/.test(b) &&
    /\b(teaching|visuals?|video|storytelling|education)\b/.test(b)
  ) {
    return "your AI content and creator education work";
  }

  if (
    /\bai\s+automation\b/.test(b) &&
    /\b(specialist|consult|business|agents?|sales|support)\b/.test(b)
  ) {
    return "your AI automation consulting work";
  }

  if (
    /\b(lecturer|professor|instructor|teacher)\b/.test(b) &&
    /\b(data\s+scientist|bioinformatician)\b/i.test(b)
  ) {
    return "your data science and bioinformatics education work";
  }

  if (
    (rcHas(rc, "founder", "solo_founder") || /\bfounder\b/.test(b)) &&
    /\b(ai\s+agents?|production\s+ai|agentic)\b/.test(b) &&
    (/\b(engineer|engineering|building)\b/.test(b) || rcHas(rc, "ai_engineer", "software_engineer"))
  ) {
    return "your AI agents founder and engineering work";
  }

  if (/\bfractional\b/.test(b) && /\bai\b/.test(b) && /\bsales\b/.test(b)) {
    return "your AI sales leadership work";
  }

  if (
    (rcHas(rc, "student") || /\bstudent\b/.test(b)) &&
    /\b(cyber\s*security|cybersecurity|infosec)\b/.test(b) &&
    !rcHas(rc, "security_practitioner", "security_leader")
  ) {
    return "your cybersecurity studies";
  }

  if (
    /\b(api|apis)\b/.test(b) &&
    /\b(secur|protect|sensitive\s+data|data\s+protection)\b/.test(b)
  ) {
    return "your API security and data protection work";
  }

  if (
    /\bprincipal\b/.test(b) &&
    /\bai\s+architect\b/.test(b) &&
    /\b(agentic|generative|mcp|rag)\b/.test(b)
  ) {
    return "your agentic AI architecture work";
  }

  if (
    /\b(identity|iam)\b/.test(b) &&
    /\b(gen\s*ai|generative\s+ai)\b/.test(b) &&
    /\b(security\s+architect|engineering\s+leader)\b/.test(b)
  ) {
    return "your identity security and GenAI architecture leadership";
  }

  if (/\bpenetration\s+tester\b/.test(b) && /\b(red\s+team|offensive)\b/.test(b)) {
    return "your offensive security work";
  }

  if (/\bdevrel\b/.test(b) && (rcHas(rc, "founder") || /\bfounder\b/.test(b))) {
    return "your developer relations and founder perspective";
  }

  if (/\biso\s*27001\b/.test(b) && /\bconsult/.test(b)) {
    return "your cybersecurity and ISO 27001 consulting work";
  }

  if (/\bprofessional\s+services\b/.test(b) && /\b(cyber|security)\b/.test(b)) {
    return "your cybersecurity professional services work";
  }

  if (rcHas(rc, "media_creator") && ftHas(ft, "ai_ml") && /\b(teaching|education|creator)\b/.test(b)) {
    return "your AI content and creator education work";
  }

  if (rcHas(rc, "academic") && /\b(data\s+scientist|bioinformatic|lecturer)\b/.test(b)) {
    return "your data science and bioinformatics education work";
  }

  if (
    rcHas(rc, "consultant") &&
    ftHas(ft, "ai_ml", "consulting") &&
    /\bautomation\b/.test(b)
  ) {
    return "your AI automation consulting work";
  }

  if (
    rcHas(rc, "sales_leader", "sales_account") &&
    ftHas(ft, "ai_ml", "sales") &&
    /\b(fractional|leader)\b/.test(b)
  ) {
    return "your AI sales leadership work";
  }

  if (
    rcHas(rc, "security_practitioner", "security_leader") &&
    /\b(api|apis)\b/.test(b)
  ) {
    return "your API security and data protection work";
  }

  if (
    (rcHas(rc, "ai_engineer", "technical_architect", "systems_architect") || ftHas(ft, "ai_ml")) &&
    /\bagentic\b/.test(b) &&
    /\barchitect\b/.test(b)
  ) {
    return "your agentic AI architecture work";
  }

  if (
    rcHas(rc, "engineering_leader", "security_leader") &&
    /\bidentity\b/.test(b) &&
    /\b(gen\s*ai|generative)\b/.test(b)
  ) {
    return "your identity security and GenAI architecture leadership";
  }

  if (
    rcHas(rc, "student") &&
    ftHas(ft, "cybersecurity", "security") &&
    !rcHas(rc, "security_practitioner")
  ) {
    return "your cybersecurity studies";
  }

  return null;
}

const GENERIC_DOMAIN_STOP =
  /\b(the|and|or|at|in|for|with|to|of|a|an|your|my|our|their|building|helping|leading|passionate|experienced|dedicated|driven)\b/i;

/**
 * Last-resort headline-anchored phrase before broad "your X work" fallbacks.
 * Uses domain tokens from the headline only — no employer names from project data.
 */
export function headlineAnchoredSafeReference(
  headline: string,
  currentTitle?: string | null
): string | null {
  const b = blob({ headline, currentTitle });
  if (b.length >= 4) {
    const explicit = explicitSafeReferenceFromHeadline(b, ["unknown"], []);
    if (explicit) return explicit;
  }

  if (isLowSignalHeadlineForSafeReference(headline)) return null;

  if (b.length < 8) return null;

  if (/\b(attended|student\s+at)\b/.test(b) && /\b(college|university|school)\b/.test(b)) {
    if (/\bengineering\b/.test(b)) return "your engineering studies";
    return "your studies";
  }
  if (/\bproduct\s+builder\b/.test(b)) {
    return "your product-building work";
  }
  if (
    /\bproduct\b/.test(b) &&
    (/\bat\b|@/.test(b) || /\bproduct\s+at\b/.test(b)) &&
    !/\bproduct\s+marketing\b/.test(b)
  ) {
    return "your product work";
  }
  if (/\bsponsor\s+finance\b/.test(b) && /\b(managing\s+director|head\s+of)\b/.test(b)) {
    return "your sponsor finance leadership";
  }

  const priority = prioritySpecificReference(b, ["unknown"], []);
  if (priority) return priority;

  const securityRef = securityDomainReference(b);
  if (securityRef) return securityRef;

  const leadershipRef = leadershipAndPlatformReference(b, ["unknown"], []);
  if (leadershipRef) return leadershipRef;

  if (/\bowasp\b/.test(b) && /\b(ai|security|infosec|pwn)\b/.test(b) && !/\bfounder\b/.test(b)) {
    return "your OWASP AI security research work";
  }
  if (/\bai[-\s]?augmented\b/.test(b) && /\b(architect|engineer|systems?)\b/.test(b)) {
    return "your AI-augmented software architecture work";
  }
  if (/\bexecutive\s+support\b/.test(b) && /\b(infrastructure|execution|operations)\b/.test(b)) {
    return "your executive support infrastructure work";
  }
  if (/\b(agentic|ai\s+agents?)\b/.test(b) && /\b(runtime|orchestrat|platform)\b/.test(b)) {
    return "your agentic AI platform work";
  }
  if (/\b(distributed\s+systems|platform\s+engineering|ai\s+platform)\b/.test(b) && /\bai\b/.test(b)) {
    if (/\b(lead|leader|director|vp|head\s+of|principal)\b/.test(b)) {
      return "your AI platform and distributed systems leadership";
    }
    return "your AI platform and distributed systems work";
  }
  if (/\b(agent\s+security|aspm|agentic\s+security)\b/.test(b)) {
    return "your agent security work";
  }
  if (/\bciso\b/.test(b) || (/\b(chief|head|director|vp)\b/.test(b) && hasCybersecurityCue(b))) {
    if (/\b(infrastructure|cloud|platform)\b/.test(b)) {
      return "your information security and infrastructure leadership";
    }
    return "your information security leadership";
  }
  if (/\b(angel|venture|vc)\b/.test(b) && /\b(invest|investor)\b/.test(b)) {
    if (/\b(cyber|security|ai)\b/.test(b)) return "your cybersecurity and AI investing work";
    return "your venture and investing work";
  }
  if (/\b(devrel|developer\s+relations)\b/.test(b)) {
    return "your developer relations work";
  }
  if (/\b(grc|governance|risk\s+compliance)\b/.test(b) && /\b(cyber|security)\b/.test(b)) {
    return "your cybersecurity GRC work";
  }
  if (/\b(penetration|offensive|red\s+team)\b/.test(b)) {
    return "your offensive security work";
  }
  if (/\b(product\s+security|appsec|application\s+security)\b/.test(b)) {
    return "your application security work";
  }
  if (/\b(soc|secops|detection\s+and\s+response)\b/.test(b)) {
    return "your security operations work";
  }
  if (
    /\b(cloud|kubernetes|terraform|aws|azure|gcp)\b/.test(b) &&
    /\b(platform|infrastructure|sre|devops)\b/.test(b)
  ) {
    return "your cloud platform engineering work";
  }
  if (/\b(laravel|shopify|react|node\.?js)\b/.test(b) && /\b(architect|engineer|developer)\b/.test(b)) {
    return "your full-stack software architecture work";
  }
  if (/\bfounder\b/.test(b) && /\b(cyber|security|infosec)\b/.test(b) && /\bai\b/.test(b)) {
    return "your AI cybersecurity founder work";
  }
  if (/\bfounder\b/.test(b) && /\b(saas|b2b|startup)\b/.test(b)) {
    return "your B2B founder work";
  }
  if (/\bfounder\b/.test(b) && /\b(product|platform)\b/.test(b)) {
    return "your product founder work";
  }
  if (/\b(enterprise\s+sales|account\s+executive|\bae\b|gtm)\b/.test(b)) {
    if (/\b(cyber|security|ai)\b/.test(b)) return "your cybersecurity and AI sales work";
    return "your enterprise sales work";
  }

  const segments = norm(headline)
    .split(/\s*[|·•/—–]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 120);
  const richest = segments.sort((a, b) => b.length - a.length)[0];
  if (!richest) return null;
  if (
    /^\s*i\s+(build|help|scale|drive|ship)\b/i.test(richest) ||
    /^\s*(helping|building|driving|securing)\b/i.test(richest)
  ) {
    return null;
  }
  if (/@/.test(richest) || /\bat\s+[A-Za-z][A-Za-z0-9]{1,24}\b/.test(richest)) {
    const fromEmployerSeg = explicitSafeReferenceFromHeadline(b, ["unknown"], []);
    if (fromEmployerSeg) return fromEmployerSeg;
    return null;
  }
  if (!PROFESSIONAL_ROLE_CUE_RE.test(richest) && !PROFESSIONAL_DOMAIN_CUE_RE.test(richest)) {
    return null;
  }

  const tokens = richest
    .replace(/[^\w\s+&/-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !GENERIC_DOMAIN_STOP.test(w))
    .slice(0, 6);
  if (tokens.length < 2) return null;

  const domain = tokens
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  if (domain.length < 6) return null;
  if (/^(founder|ceo|consultant|engineer|manager|director)$/i.test(domain)) return null;
  if (!PROFESSIONAL_ROLE_CUE_RE.test(domain) && !PROFESSIONAL_DOMAIN_CUE_RE.test(domain)) {
    return null;
  }

  return `your ${domain.toLowerCase()} work`;
}

/**
 * Outreach-safe phrase from headline domain + labels when richer rules did not match.
 * Never returns thread-level generic copy.
 */
export function professionalDomainOutreachReference(args: {
  headline: string;
  currentTitle?: string | null;
  roleCategories: ProspectClassification["roleCategories"];
  functionTags: ProspectClassification["functionTags"];
}): string | null {
  const explicit = resolveExplicitSafeProfessionalReference(args);
  if (explicit) return explicit;

  if (isLowSignalHeadlineForSafeReference(args.headline)) return null;

  const composed = composeSafeProfessionalReference(args);
  if (composed) return composed;

  const anchored = headlineAnchoredSafeReference(args.headline, args.currentTitle);
  if (anchored) return anchored;

  const b = blob(args);
  const rc = args.roleCategories;
  const ft = args.functionTags;

  if (/\b(agent\s+security|aspm|agentic\s+security)\b/.test(b)) {
    return "your agent security work";
  }
  if (
    /\bproduct\s+security\b/.test(b) ||
    (rcHas(rc, "security_practitioner", "security_leader") && /\bproduct\b/.test(b))
  ) {
    return "your product security engineering work";
  }
  if (/\b(dev\s*sec|developer\s+security|devsecops)\b/.test(b)) {
    return "your developer security work";
  }
  if (
    /\bai\s+platforms?\b/.test(b) ||
    /\bdistributed\s+systems\b/.test(b) ||
    (/\btech\s+lead\b/.test(b) && /\bai\b/.test(b) && /\b(platform|distributed)\b/.test(b))
  ) {
    return "your AI platform and distributed systems leadership";
  }
  if (
    /\bciso\b/.test(b) ||
    rcHas(rc, "security_leader") ||
    (/\b(chief|head|director|vp)\b/.test(b) && hasCybersecurityCue(b))
  ) {
    if (/\b(infrastructure|cloud|platform)\b/.test(b)) {
      return "your information security and infrastructure leadership";
    }
    return "your information security leadership";
  }
  if (
    (/\bcloud\s+platform\b/.test(b) || /\bplatform\s+engineer\b/.test(b)) &&
    (/\b(aws|azure|gcp|kubernetes|terraform|cloud)\b/.test(b) || ftHas(ft, "cloud", "platform"))
  ) {
    return "your cloud platform engineering work";
  }
  if (
    /\b(data\s+platform|data\s+and\s+ai)\b/.test(b) ||
    (ftHas(ft, "data", "data_analytics") && ftHas(ft, "ai_ml"))
  ) {
    return "your data and AI platform work";
  }
  if (/\bfounder\b/.test(b) || rcHas(rc, "founder", "solo_founder")) {
    if (hasCybersecurityCue(b) && /\bai\b/.test(b)) {
      return "your AI cybersecurity founder and architecture work";
    }
    if (hasCybersecurityCue(b)) return "your cybersecurity founder work";
    if (/\bai\b/.test(b)) return "your AI founder work";
    return "your founder leadership work";
  }
  if (hasCybersecurityCue(b)) {
    return "your cybersecurity leadership work";
  }
  if (rcHas(rc, "hr_leader", "recruiter", "people_leader")) {
    return "your HR and talent leadership work";
  }
  if (rcHas(rc, "customer_success_leader", "account_management")) {
    return "your customer success work";
  }
  if (rcHas(rc, "partnerships_leader", "gtm_leader") && /\balliances?\b/.test(b)) {
    return "your global alliances leadership";
  }
  if (rcHas(rc, "product_manager", "product_leader")) {
    return "your product management work";
  }
  if (rcHas(rc, "student") && /\bengineering\b/.test(b)) {
    return "your engineering studies";
  }
  if (rcHas(rc, "coach_or_advisor") && /\bcoach\b/.test(b)) {
    return "your leadership coaching work";
  }
  if (ftHas(ft, "ai_ml") || /\bai\b/.test(b)) {
    return "your AI and technology work";
  }
  if (ftHas(ft, "engineering") || /\bengineer/i.test(b)) {
    return "your engineering and technology work";
  }

  return null;
}
