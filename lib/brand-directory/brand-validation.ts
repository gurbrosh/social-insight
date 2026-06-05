/**
 * Validation utilities for brand data to catch errors and inconsistencies
 */

/**
 * Extract domain/handle from a URL for comparison
 */
function extractDomainFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Remove www. prefix
    const domain = hostname.replace(/^www\./, "");

    // Extract main domain (e.g., "avant.com" from "www.avant.com")
    const parts = domain.split(".");
    if (parts.length >= 2) {
      return parts[parts.length - 2]; // Get the main domain name
    }
    return domain;
  } catch {
    return null;
  }
}

/**
 * Extract handle/username from social media URLs
 */
function extractHandleFromUrl(url: string, platform: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    switch (platform.toLowerCase()) {
      case "linkedin":
        // linkedin.com/company/avant or linkedin.com/in/avant
        const linkedinMatch = pathname.match(/\/(?:company|in)\/([^/]+)/);
        return linkedinMatch ? linkedinMatch[1] : null;
      case "facebook":
        // facebook.com/avant
        const fbMatch = pathname.match(/^\/([^/?]+)/);
        return fbMatch ? fbMatch[1] : null;
      case "x":
      case "twitter":
        // x.com/avant or twitter.com/avant
        const xMatch = pathname.match(/^\/([^/?]+)/);
        return xMatch ? xMatch[1] : null;
      case "instagram":
        // instagram.com/avant
        const igMatch = pathname.match(/^\/([^/?]+)/);
        return igMatch ? igMatch[1] : null;
      case "tiktok":
        // tiktok.com/@avant
        const tiktokMatch = pathname.match(/^\/@?([^/?]+)/);
        return tiktokMatch ? tiktokMatch[1] : null;
      case "youtube":
        // youtube.com/@avant or youtube.com/c/avant
        const ytMatch = pathname.match(/\/(?:@|c|channel|user)\/([^/?]+)/);
        return ytMatch ? ytMatch[1] : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Normalize brand name for comparison (lowercase, remove spaces, special chars)
 */
function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Check if a URL matches a brand name (fuzzy matching)
 */
function urlMatchesBrandName(url: string, brandName: string, companyName?: string): boolean {
  const normalizedBrand = normalizeBrandName(brandName);
  const normalizedCompany = companyName ? normalizeBrandName(companyName) : null;

  const domain = extractDomainFromUrl(url);
  if (domain) {
    // Check if domain contains brand name or company name
    if (domain.includes(normalizedBrand) || normalizedBrand.includes(domain)) {
      return true;
    }
    if (
      normalizedCompany &&
      (domain.includes(normalizedCompany) || normalizedCompany.includes(domain))
    ) {
      return true;
    }
  }

  // Check pathname/handle
  const pathname = url.toLowerCase();
  if (
    pathname.includes(normalizedBrand) ||
    normalizedBrand.includes(pathname.replace(/[^a-z0-9]/g, ""))
  ) {
    return true;
  }
  if (
    normalizedCompany &&
    (pathname.includes(normalizedCompany) ||
      normalizedCompany.includes(pathname.replace(/[^a-z0-9]/g, "")))
  ) {
    return true;
  }

  return false;
}

export interface BrandValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate brand data for consistency and potential errors
 */
export function validateBrandData(data: {
  brand_name: string;
  company_name: string;
  website_url?: string | null;
  careers_url?: string | null;
  blog_news_url?: string | null;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  x_url?: string | null;
  instagram_url?: string | null;
  tiktok_url?: string | null;
  youtube_url?: string | null;
  discord_url?: string | null;
}): BrandValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const normalizedBrand = normalizeBrandName(data.brand_name);
  const normalizedCompany = normalizeBrandName(data.company_name);

  // Check website URL
  if (data.website_url) {
    const domain = extractDomainFromUrl(data.website_url);
    if (domain) {
      const brandInDomain = domain.includes(normalizedBrand) || normalizedBrand.includes(domain);
      const companyInDomain =
        domain.includes(normalizedCompany) || normalizedCompany.includes(domain);

      if (!brandInDomain && !companyInDomain) {
        warnings.push(
          `Website URL domain "${domain}" doesn't appear to match brand name "${data.brand_name}" or company name "${data.company_name}". Please verify this is correct.`
        );
      }
    }
  }

  // Check LinkedIn URL
  if (data.linkedin_url) {
    const handle = extractHandleFromUrl(data.linkedin_url, "linkedin");
    if (handle) {
      const normalizedHandle = normalizeBrandName(handle);
      const brandMatches =
        normalizedHandle.includes(normalizedBrand) || normalizedBrand.includes(normalizedHandle);
      const companyMatches =
        normalizedHandle.includes(normalizedCompany) ||
        normalizedCompany.includes(normalizedHandle);

      if (!brandMatches && !companyMatches) {
        warnings.push(
          `LinkedIn URL handle "${handle}" doesn't appear to match brand name "${data.brand_name}" or company name "${data.company_name}". Please verify this is correct.`
        );
      }
    }
  }

  // Check Facebook URL
  if (data.facebook_url) {
    if (!urlMatchesBrandName(data.facebook_url, data.brand_name, data.company_name)) {
      warnings.push(
        `Facebook URL doesn't appear to match brand name "${data.brand_name}" or company name "${data.company_name}". Please verify this is correct.`
      );
    }
  }

  // Check X/Twitter URL
  if (data.x_url) {
    const handle = extractHandleFromUrl(data.x_url, "x");
    if (handle) {
      const normalizedHandle = normalizeBrandName(handle);
      const brandMatches =
        normalizedHandle.includes(normalizedBrand) || normalizedBrand.includes(normalizedHandle);
      const companyMatches =
        normalizedHandle.includes(normalizedCompany) ||
        normalizedCompany.includes(normalizedHandle);

      if (!brandMatches && !companyMatches) {
        warnings.push(
          `X/Twitter URL handle "${handle}" doesn't appear to match brand name "${data.brand_name}" or company name "${data.company_name}". Please verify this is correct.`
        );
      }
    }
  }

  // Check Instagram URL
  if (data.instagram_url) {
    const handle = extractHandleFromUrl(data.instagram_url, "instagram");
    if (handle) {
      const normalizedHandle = normalizeBrandName(handle);
      const brandMatches =
        normalizedHandle.includes(normalizedBrand) || normalizedBrand.includes(normalizedHandle);
      const companyMatches =
        normalizedHandle.includes(normalizedCompany) ||
        normalizedCompany.includes(normalizedHandle);

      if (!brandMatches && !companyMatches) {
        warnings.push(
          `Instagram URL handle "${handle}" doesn't appear to match brand name "${data.brand_name}" or company name "${data.company_name}". Please verify this is correct.`
        );
      }
    }
  }

  // Check for common typos (e.g., "Tavant" vs "Avant")
  // Only flag known incorrect spellings, not the correct ones
  const knownTypos: Record<string, string> = {
    tavant: "avant", // "Tavant" is likely a typo of "Avant"
    avent: "avant",
    avantt: "avant",
  };

  const brandLower = data.brand_name.toLowerCase();
  if (knownTypos[brandLower]) {
    // This is a warning, not an error - user can override
    warnings.push(
      `Potential typo detected: Brand name "${data.brand_name}" might be incorrect. Did you mean "${knownTypos[brandLower]}"? You can proceed if this is intentional.`
    );
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}
