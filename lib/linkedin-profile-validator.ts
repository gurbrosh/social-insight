/**
 * LinkedIn Profile Validator
 *
 * Analyzes LinkedIn profiles to determine if people are still at their tracked company.
 * Uses browser automation to extract profile data and OpenAI for complex analysis when needed.
 */

interface LinkedInProfileAnalysis {
  profileUrl: string;
  name?: string;
  currentCompany?: string;
  currentTitle?: string;
  hasMovedCompany: boolean;
  titleChanged?: boolean;
  previousTitle?: string;
  analysisMethod: "browser" | "openai" | "error";
  confidence: "high" | "medium" | "low";
  error?: string;
  rawData?: any;
}

interface ProfileExtractionResult {
  name?: string;
  currentCompany?: string;
  experienceItems?: Array<{
    company?: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
  }>;
  pageTitle?: string;
}

/**
 * Extract profile information using OpenAI
 * Uses OpenAI to analyze LinkedIn profile information from URL and any provided content
 */
export async function extractLinkedInProfileData(
  profileUrl: string,
  profileText?: string
): Promise<ProfileExtractionResult> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const { configService } = await import("@/lib/config-service");
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  // Extract username from LinkedIn URL
  const urlMatch = profileUrl.match(/linkedin\.com\/in\/([^/?]+)/);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const username = urlMatch ? urlMatch[1] : null;

  const prompt = `Analyze this LinkedIn profile and extract key information:

LinkedIn Profile URL: ${profileUrl}
${profileText ? `\nProfile Content/Text:\n${profileText.substring(0, 2000)}` : ""}

Extract the following information:
1. Full name of the person
2. Current company name (if they're currently employed)
3. Current job title (if available)
4. Experience history (list of companies with titles and dates, marking which is current)

If profile text is missing or too short to support a claim, return null for name, current company, and current title. Do not infer employer or job title from the LinkedIn URL slug or path alone.
If the profile is private or information is not available, return null values.

Return ONLY valid JSON in this exact format:
{
  "name": "Full Name or null",
  "currentCompany": "Company Name or null",
  "currentTitle": "Job Title or null",
  "experienceItems": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "startDate": "YYYY-MM or null",
      "endDate": "YYYY-MM or null",
      "isCurrent": true or false
    }
  ],
  "pageTitle": "LinkedIn Page Title or null"
}`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a LinkedIn profile analyzer. Extract structured information from LinkedIn profiles. Return ONLY valid JSON, no other text.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        name: undefined,
        currentCompany: undefined,
        experienceItems: [],
        pageTitle: undefined,
      };
    }

    // Strip markdown code fences if present
    content = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(content);
    return {
      name: parsed.name || undefined,
      currentCompany: parsed.currentCompany || undefined,
      experienceItems: parsed.experienceItems || [],
      pageTitle: parsed.pageTitle || undefined,
    };
  } catch (error) {
    console.error("Error extracting LinkedIn profile data:", error);
    return {
      name: undefined,
      currentCompany: undefined,
      experienceItems: [],
      pageTitle: undefined,
    };
  }
}

/**
 * Analyze LinkedIn profile using OpenAI to extract company information
 * Useful when profile details are masked or need deeper analysis
 */
export async function analyzeLinkedInProfileWithOpenAI(
  profileUrl: string,
  profileHtml?: string,
  profileText?: string
): Promise<{
  name?: string;
  currentCompany?: string;
  currentTitle?: string;
  previousCompanies?: string[];
  hasRecentJobChange?: boolean;
  mostRecentCompany?: string;
  analysis?: string;
  experienceItems?: Array<{
    company?: string;
    title?: string;
    startDate?: string;
    endDate?: string;
    isCurrent?: boolean;
  }>;
}> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const { configService } = await import("@/lib/config-service");
  const openaiBaseUrl =
    (await configService.getConfig("api", "openai_base_url")) || "https://api.openai.com/v1";

  // Truncate HTML/text to avoid token limits
  const htmlContent = profileHtml ? profileHtml.substring(0, 5000) : "";
  const textContent = profileText ? profileText.substring(0, 2000) : "";

  const prompt = `Analyze this LinkedIn profile in detail:

LinkedIn Profile URL: ${profileUrl}
${htmlContent ? `\nProfile HTML (first 5000 chars):\n${htmlContent}` : ""}
${textContent ? `\nProfile Text:\n${textContent}` : ""}

Extract comprehensive information:
1. Full name
2. Current company (most recent/current employment)
3. Current job title
4. Previous companies (if any)
5. Whether there was a recent job change (within last 6 months)
6. Complete experience history with dates

Focus on:
- Identifying the CURRENT/MOST RECENT company and title
- Detecting if the person recently changed jobs
- Understanding their employment timeline

Return ONLY valid JSON in this exact format:
{
  "name": "Full Name or null",
  "currentCompany": "Current Company Name or null",
  "currentTitle": "Current Job Title or null",
  "previousCompanies": ["Company 1", "Company 2"],
  "hasRecentJobChange": true or false,
  "mostRecentCompany": "Most Recent Company Name or null",
  "analysis": "Brief analysis of employment status",
  "experienceItems": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "startDate": "YYYY-MM or null",
      "endDate": "YYYY-MM or null",
      "isCurrent": true or false
    }
  ]
}`;

  try {
    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert LinkedIn profile analyzer. Extract detailed employment information from LinkedIn profiles. Focus on identifying current employment status and recent job changes. Return ONLY valid JSON, no other text.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        name: undefined,
        currentCompany: undefined,
        currentTitle: undefined,
        previousCompanies: [],
        hasRecentJobChange: false,
        mostRecentCompany: undefined,
        analysis: undefined,
        experienceItems: [],
      };
    }

    // Strip markdown code fences if present
    content = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(content);
    return {
      name: parsed.name || undefined,
      currentCompany: parsed.currentCompany || undefined,
      currentTitle: parsed.currentTitle || undefined,
      previousCompanies: parsed.previousCompanies || [],
      hasRecentJobChange: parsed.hasRecentJobChange || false,
      mostRecentCompany: parsed.mostRecentCompany || parsed.currentCompany || undefined,
      analysis: parsed.analysis || undefined,
      experienceItems: parsed.experienceItems || [],
    };
  } catch (error) {
    console.error("Error analyzing LinkedIn profile with OpenAI:", error);
    return {
      name: undefined,
      currentCompany: undefined,
      currentTitle: undefined,
      previousCompanies: [],
      hasRecentJobChange: false,
      mostRecentCompany: undefined,
      analysis: undefined,
      experienceItems: [],
    };
  }
}

/**
 * Main function to validate if a LinkedIn profile belongs to someone
 * who has moved to a new company (different from tracked companies)
 */
export async function validateLinkedInProfile(
  profileUrl: string,
  trackedCompanies: string[],
  options?: {
    useOpenAI?: boolean;
    profileHtml?: string;
    profileText?: string;
  }
): Promise<LinkedInProfileAnalysis> {
  try {
    // Normalize tracked company names for comparison
    const normalizedTrackedCompanies = trackedCompanies.map((company) =>
      company.toLowerCase().trim()
    );

    // Try extraction first (using OpenAI)
    let extractionResult: ProfileExtractionResult;
    try {
      extractionResult = await extractLinkedInProfileData(profileUrl, options?.profileText);
    } catch (error) {
      console.error("Profile extraction failed:", error);
      extractionResult = {};
    }

    // Check experience items for end dates at tracked companies
    const hasLeftTrackedCompany = (() => {
      if (!extractionResult.experienceItems || extractionResult.experienceItems.length === 0) {
        return false;
      }

      // Check if any experience at a tracked company has an end date (not current)
      for (const exp of extractionResult.experienceItems) {
        if (!exp.company) continue;
        const normalizedExpCompany = exp.company.toLowerCase().trim();
        const isTrackedCompany = normalizedTrackedCompanies.some(
          (tracked) =>
            normalizedExpCompany.includes(tracked) || tracked.includes(normalizedExpCompany)
        );

        // If it's a tracked company and has an end date (or isCurrent is false), they left
        if (isTrackedCompany && (exp.endDate || !exp.isCurrent)) {
          return true;
        }
      }
      return false;
    })();

    // If we have current company from extraction, use it
    if (extractionResult.currentCompany) {
      const normalizedCurrent = extractionResult.currentCompany.toLowerCase().trim();
      const isAtTrackedCompany = normalizedTrackedCompanies.some(
        (tracked) => normalizedCurrent.includes(tracked) || tracked.includes(normalizedCurrent)
      );

      // Find current position from experience items
      const currentPosition = extractionResult.experienceItems?.find((exp) => exp.isCurrent);
      const currentTitle = currentPosition?.title || undefined;

      // If they have an end date at tracked company OR current company doesn't match, they've moved
      const hasMoved = hasLeftTrackedCompany || !isAtTrackedCompany;

      return {
        profileUrl,
        name: extractionResult.name,
        currentCompany: extractionResult.currentCompany,
        currentTitle: currentTitle,
        hasMovedCompany: hasMoved,
        titleChanged: false, // Will be set by caller if comparing with previous title
        analysisMethod: "openai",
        confidence: "high",
        rawData: extractionResult,
      };
    }

    // If no current company but they have an end date at tracked company, they've left
    if (hasLeftTrackedCompany) {
      return {
        profileUrl,
        name: extractionResult.name,
        currentCompany: undefined,
        currentTitle: undefined,
        hasMovedCompany: true,
        titleChanged: false,
        analysisMethod: "openai",
        confidence: "high",
        rawData: extractionResult,
      };
    }

    // If extraction didn't work and OpenAI is enabled, try deeper OpenAI analysis
    if (options?.useOpenAI && !extractionResult.currentCompany && !hasLeftTrackedCompany) {
      try {
        const openaiResult = await analyzeLinkedInProfileWithOpenAI(
          profileUrl,
          options.profileHtml,
          options.profileText
        );

        // Check experience items from OpenAI result for end dates at tracked companies
        const hasLeftTrackedCompanyFromOpenAI = (() => {
          if (!openaiResult.experienceItems || openaiResult.experienceItems.length === 0) {
            return false;
          }

          for (const exp of openaiResult.experienceItems) {
            if (!exp.company) continue;
            const normalizedExpCompany = exp.company.toLowerCase().trim();
            const isTrackedCompany = normalizedTrackedCompanies.some(
              (tracked) =>
                normalizedExpCompany.includes(tracked) || tracked.includes(normalizedExpCompany)
            );

            // If it's a tracked company and has an end date (or isCurrent is false), they left
            if (isTrackedCompany && (exp.endDate || !exp.isCurrent)) {
              return true;
            }
          }
          return false;
        })();

        if (
          openaiResult.currentCompany ||
          openaiResult.mostRecentCompany ||
          hasLeftTrackedCompanyFromOpenAI
        ) {
          const currentCompany: string | undefined =
            (openaiResult.currentCompany || openaiResult.mostRecentCompany) ?? undefined;
          const normalizedCurrent = (currentCompany || "").toLowerCase().trim();
          const isAtTrackedCompany = currentCompany
            ? normalizedTrackedCompanies.some(
                (tracked) =>
                  normalizedCurrent.includes(tracked) || tracked.includes(normalizedCurrent)
              )
            : false;

          // If they left tracked company OR current company doesn't match, they've moved
          const hasMoved: boolean =
            hasLeftTrackedCompanyFromOpenAI || (!!currentCompany && !isAtTrackedCompany);

          return {
            profileUrl,
            name: openaiResult.name,
            currentCompany: currentCompany,
            currentTitle: openaiResult.currentTitle,
            hasMovedCompany: hasMoved,
            titleChanged: false, // Will be set by caller if comparing with previous title
            analysisMethod: "openai",
            confidence: openaiResult.hasRecentJobChange ? "high" : "medium",
            rawData: openaiResult,
          };
        }
      } catch (error) {
        console.error("OpenAI analysis failed:", error);
      }
    }

    // If we couldn't determine company, return error
    return {
      profileUrl,
      hasMovedCompany: false, // Default to false if we can't determine
      analysisMethod: "error",
      confidence: "low",
      error: "Could not extract company information from profile",
      rawData: extractionResult,
    };
  } catch (error) {
    return {
      profileUrl,
      hasMovedCompany: false,
      analysisMethod: "error",
      confidence: "low",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Batch validate multiple LinkedIn profiles
 */
export async function validateLinkedInProfiles(
  profileUrls: string[],
  trackedCompanies: string[],
  options?: {
    useOpenAI?: boolean;
    concurrency?: number;
  }
): Promise<LinkedInProfileAnalysis[]> {
  const results: LinkedInProfileAnalysis[] = [];
  const concurrency = options?.concurrency || 3;

  // Process profiles in batches
  for (let i = 0; i < profileUrls.length; i += concurrency) {
    const batch = profileUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((url) => validateLinkedInProfile(url, trackedCompanies, options))
    );
    results.push(...batchResults);
  }

  return results;
}
