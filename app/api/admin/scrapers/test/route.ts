import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { apifyService } from "@/lib/apify-service";
import { prisma } from "@/lib/prisma";
import { configService } from "@/lib/config-service";

export const dynamic = "force-dynamic";
export const maxDuration = 900; // 15 minutes - extended timeout for Reddit scraper

const testScraperSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    actor_id: z.string().min(1, "Actor ID is required"),
    platform: z.enum(["facebook", "linkedin", "x", "reddit", "discord", "website"]),
    config_json: z.string().min(1, "Configuration JSON is required"),
    save_to_db: z.boolean().default(true), // Include save_to_db setting
    url_input_field_name: z.string().optional(),
    url_input_source_scraper: z.string().optional(),
    testInput: z.object({
      keywords: z.array(z.string()).optional(),
    }),
    saveTestResults: z.boolean().default(false),
    projectId: z.string().nullable().optional(),
  })
  .refine(
    (data) => {
      // Either keywords must be provided OR URL input configuration must be provided OR it's a Discord scraper OR it's an X/LinkedIn/Facebook scraper with project
      const hasKeywords = data.testInput.keywords && data.testInput.keywords.length > 0;
      const hasUrlInput = data.url_input_field_name && data.url_input_source_scraper;
      const isDiscord = data.platform === "discord";
      const isXWithProject = data.platform === "x" && data.projectId;
      const isLinkedInWithProject = data.platform === "linkedin" && data.projectId;
      const isFacebookWithProject = data.platform === "facebook" && data.projectId;
      return (
        hasKeywords ||
        hasUrlInput ||
        isDiscord ||
        isXWithProject ||
        isLinkedInWithProject ||
        isFacebookWithProject
      );
    },
    {
      message:
        "Either keywords, URL input configuration, or project selection (for X/LinkedIn/Facebook scrapers) must be provided",
      path: ["testInput", "keywords"],
    }
  );

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validatedData = testScraperSchema.parse(body);
    const { actor_id, platform, config_json, testInput, saveTestResults, projectId } =
      validatedData;

    // Type assertion to ensure TypeScript recognizes discord as valid platform
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const platformType = platform as
      | "facebook"
      | "linkedin"
      | "x"
      | "reddit"
      | "discord"
      | "website";

    // Helper function to check if platform is Discord
    const isDiscord = (p: string): p is "discord" => p === "discord";

    // Store original config for Discord placeholder replacement
    const originalConfigJson = config_json;

    // Parse config with placeholder support (replace placeholders with valid JSON for parsing)
    let config;
    try {
      // First, try to parse as-is
      config = JSON.parse(config_json);
    } catch {
      // If that fails, replace placeholders with valid JSON values for parsing
      try {
        const configWithPlaceholders = config_json
          .replace(/"\{\{keywords\}\}"/g, '"placeholder1,placeholder2"')
          .replace(/\{\{keywords\}\}/g, '["placeholder1", "placeholder2"]')
          .replace(/"\{\{keyword\}\}"/g, '"placeholder"')
          .replace(/\{\{keyword\}\}/g, '"placeholder"')
          .replace(/"\{\{urls\}\}"/g, '"https://discord.com/channels/123/456"')
          .replace(/\{\{urls\}\}/g, '["https://example.com"]')
          .replace(/"\{\{url\}\}"/g, '"https://example.com"')
          .replace(/\{\{url\}\}/g, '"https://example.com"')
          .replace(/\[user_selected_discord_urls\]/g, '"https://discord.com/channels/123/456"');

        config = JSON.parse(configWithPlaceholders);
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid JSON configuration format",
          },
          { status: 400 }
        );
      }
    }
    const keywords = testInput.keywords || [];
    const hasUrlInput =
      validatedData.url_input_field_name && validatedData.url_input_source_scraper;

    console.log("Test scraper - Parsed config:", config);
    console.log("Test scraper - Actor ID:", actor_id);
    console.log("Test scraper - Keywords:", keywords);
    console.log("Test scraper - URL Input Config:", {
      fieldName: validatedData.url_input_field_name,
      sourceScraper: validatedData.url_input_source_scraper,
    });
    console.log("Test scraper - Project ID:", projectId);
    console.log("Test scraper - Save test results:", saveTestResults);
    console.log("Test scraper - Save to DB setting:", validatedData.save_to_db);

    // Validate that projectId is provided when needed
    if (hasUrlInput && (!projectId || projectId === null)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Project ID is required for downstream scrapers to fetch URLs from DownstreamPost table. Please select a project in the UI.",
        },
        { status: 400 }
      );
    }

    if (
      saveTestResults &&
      (!projectId || projectId === null || projectId === undefined) &&
      !isDiscord(platform)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Project ID is required when saving test results. Please select a project in the UI.",
        },
        { status: 400 }
      );
    }

    const results = [];
    let totalItems = 0;
    let testDiscordUrls: string[] = [];

    // For downstream scrapers (URL input), always save results to test the complete flow
    // For keyword scrapers, only save if saveTestResults is true
    // For Discord scrapers, allow saving without project ID
    const shouldSaveResults =
      hasUrlInput ||
      (saveTestResults && ((projectId && projectId !== null) || isDiscord(platform)));

    // Determine test inputs based on configuration
    // Discord scrapers don't need keywords or URL input - they use their config directly
    // X/LinkedIn scrapers with project selection use project profiles instead of keywords
    // Reddit scrapers accept arrays, so run once with all keywords combined
    const testInputs = hasUrlInput
      ? ["url-input-test"]
      : isDiscord(platform)
        ? ["discord-test"]
        : (platform === "x" || platform === "linkedin") && projectId
          ? [`${platform}-project-test`]
          : platform === "reddit" && projectId
            ? ["reddit-all-keywords"]
            : keywords;

    for (const testInputItem of testInputs) {
      // For URL input scrapers, we need to simulate the URL injection process
      let input;
      if (isDiscord(platform)) {
        // For Discord scrapers, run once per Discord URL (like in production)

        // Try to fetch real Discord URLs from project profiles
        if (projectId) {
          // If projectId is provided, fetch from that specific project
          try {
            const discordProfiles = await apifyService.fetchDiscordUrlsFromProject(projectId);
            testDiscordUrls = discordProfiles.map((p) => p.url);
          } catch {}
        } else {
          // If no projectId, fetch from all projects that have Discord profiles
          try {
            const { prisma } = await import("@/lib/prisma");
            const allDiscordProfiles = await prisma.projectProfile.findMany({
              where: {
                platform: "discord",
                type: "channel",
                is_selected: true,
                deleted_at: null,
              },
              select: {
                url: true,
                project_id: true,
              },
            });

            testDiscordUrls = allDiscordProfiles.map((profile) => profile.url);
          } catch {}
        }

        // If no real URLs found, use a test URL
        if (testDiscordUrls.length === 0) {
          testDiscordUrls = [
            "https://discord.com/channels/1074847526655643750/1074847527708393565",
          ];
        }

        // Run Discord scraper once for each URL (like in production)
        const results: any[] = [];
        for (let i = 0; i < testDiscordUrls.length; i++) {
          const discordUrl = testDiscordUrls[i];

          // Replace placeholders in original config string with current URL
          let originalConfig;
          try {
            // Try to parse original config as-is first
            originalConfig = JSON.parse(originalConfigJson);
          } catch {
            // If that fails, replace Discord placeholder with a temporary value for parsing
            const tempConfigJson = originalConfigJson
              .replace(/\[user_selected_discord_urls\]/g, '"temp-placeholder"')
              .replace(/"\{\{urls\}\}"/g, '"temp-placeholder"');
            originalConfig = JSON.parse(tempConfigJson);
          }

          const currentInput = apifyService.replaceDiscordUrlPlaceholders(
            originalConfig,
            discordUrl
          );

          // Run scraper synchronously for this URL
          const keyword = `discord-test-${i + 1}`;
          try {
            const runResult = await apifyService.runScraperSync(actor_id, currentInput, platform);
            results.push({ url: discordUrl, keyword, result: runResult });
          } catch (error) {
            results.push({ url: discordUrl, keyword, error: error });
          }
        }

        // Process results and save to database if requested
        if (shouldSaveResults) {
          for (const result of results) {
            if (result.result && !result.error) {
              // Check if we have a dataset ID to fetch items from
              if (result.result.defaultDatasetId) {
                try {
                  const items = await apifyService.getDatasetItems(result.result.defaultDatasetId);

                  if (items.length > 0) {
                    const { savedCount } = await apifyService.processAndSavePosts(
                      projectId || "", // Provide empty string fallback for Discord scrapers
                      null, // No job for test data
                      items,
                      true, // isTest = true for test results
                      platform, // Pass the platform
                      validatedData.name, // scraper name
                      validatedData.save_to_db ?? true // Respect scraper's save_to_db setting for test results
                    );
                    totalItems += savedCount;
                  } else {
                  }
                } catch {}
              } else {
              }
            } else if (result.error) {
            }
          }
        }

        // Skip the regular test loop for Discord scrapers since we already processed everything
        continue;
      } else if (platform === "x" && projectId) {
        // For X scrapers with project selection, use project profiles instead of keywords
        console.log(`Processing X scraper with project profiles for project: ${projectId}`);

        // Fetch X profiles from the project
        const xProfiles = await prisma.projectProfile.findMany({
          where: {
            project_id: projectId,
            platform: "x",
            is_selected: true,
            deleted_at: null,
          },
          select: {
            url: true,
            name: true,
            type: true,
          },
        });

        console.log(`Found ${xProfiles.length} X profiles for project:`, xProfiles);

        if (xProfiles.length === 0) {
          console.log("No X profiles found for project, using empty keywords");
          // Use empty keywords if no profiles found
          const resolvedConfig = apifyService.resolveConfigPlaceholders(config, {
            keyword: "test",
            keywords: [], // Empty keywords for X scraper
          });

          input = resolvedConfig;
        } else {
          // Use the X profiles as input
          const resolvedConfig = await apifyService.resolveXConfigPlaceholders(
            config,
            [],
            projectId,
            actor_id,
            undefined
          );
          input = resolvedConfig;
        }

        console.log(`Testing X scraper with project profiles, input:`, input);
      } else if (platform === "linkedin" && projectId) {
        // For LinkedIn scrapers with project selection, use project profiles instead of keywords
        console.log(`Processing LinkedIn scraper with project profiles for project: ${projectId}`);

        // Fetch LinkedIn profiles from the project
        const linkedinProfiles = await prisma.projectProfile.findMany({
          where: {
            project_id: projectId,
            platform: "linkedin",
            is_selected: true,
            deleted_at: null,
          },
          select: {
            url: true,
            name: true,
            type: true,
          },
        });

        console.log(
          `Found ${linkedinProfiles.length} LinkedIn profiles for project:`,
          linkedinProfiles
        );

        if (linkedinProfiles.length === 0) {
          console.log("No LinkedIn profiles found for project, using empty keywords");
          // Use empty keywords if no profiles found
          const resolvedConfig = apifyService.resolveConfigPlaceholders(config, {
            keyword: "test",
            keywords: [], // Empty keywords for LinkedIn scraper
          });

          input = resolvedConfig;
        } else {
          // Use the LinkedIn profiles as input
          const resolvedConfig = await apifyService.resolveLinkedInConfigPlaceholders(
            config,
            [],
            projectId
          );
          input = resolvedConfig;
        }

        console.log(`Testing LinkedIn scraper with project profiles, input:`, input);
      } else if (platform === "facebook" && projectId) {
        // For Facebook scrapers with project selection, check if scraper needs URLs (startUrls) or keywords
        // Facebook Posts Scraper needs startUrls (Facebook page URLs)
        // Facebook Posts Search uses keywords
        const hasStartUrlsField =
          config.startUrls !== undefined || config_json.includes("startUrls");
        const startUrlsIsEmpty = Array.isArray(config.startUrls) && config.startUrls.length === 0;
        const startUrlsHasPlaceholders =
          Array.isArray(config.startUrls) &&
          config.startUrls.some(
            (item: any) =>
              (typeof item === "string" && item.includes("{{")) ||
              (typeof item === "object" &&
                item.url &&
                typeof item.url === "string" &&
                item.url.includes("{{"))
          );
        const needsStartUrls =
          hasStartUrlsField &&
          (startUrlsIsEmpty ||
            startUrlsHasPlaceholders ||
            !config.keywords ||
            config.keywords.length === 0);

        if (needsStartUrls) {
          console.log(`Processing Facebook scraper with project URLs for project: ${projectId}`);

          // Fetch Facebook URLs from project profiles
          const facebookProfiles = await prisma.projectProfile.findMany({
            where: {
              project_id: projectId,
              platform: "facebook",
              is_selected: true,
              deleted_at: null,
            },
            select: { url: true },
          });

          // Also get Facebook URLs from brand directory
          const { getBrandDirectoryUrlsForProject } = await import(
            "@/lib/brand-directory/project-brand-urls-service"
          );
          const brandDirectoryUrls = await getBrandDirectoryUrlsForProject(projectId);

          // Combine and deduplicate URLs
          const allFacebookUrls = [
            ...facebookProfiles.map((p) => p.url),
            ...brandDirectoryUrls.facebookUrls,
          ];
          const uniqueUrls = Array.from(
            new Set(allFacebookUrls.map((url) => url.trim().toLowerCase().replace(/\/+$/, "")))
          );
          const deduplicatedUrls = allFacebookUrls.filter((url, index, self) => {
            const normalized = url.trim().toLowerCase().replace(/\/+$/, "");
            return (
              self.findIndex((u) => u.trim().toLowerCase().replace(/\/+$/, "") === normalized) ===
              index
            );
          });

          console.log(
            `Found ${facebookProfiles.length} Facebook profiles, ${brandDirectoryUrls.facebookUrls.length} brand directory URLs, ${deduplicatedUrls.length} total (deduplicated)`
          );

          if (deduplicatedUrls.length === 0) {
            return NextResponse.json(
              {
                success: false,
                error:
                  "No Facebook URLs found for this project. Please add Facebook page URLs via Project Profiles or Brand Directory.",
              },
              { status: 400 }
            );
          }

          // Format URLs as objects for startUrls (Facebook scrapers expect [{ url: "..." }])
          const formattedUrls = deduplicatedUrls.map((url) => ({ url }));

          // Deep clone config to avoid mutating original
          const resolvedConfig = JSON.parse(JSON.stringify(config));

          // Replace any placeholder values in startUrls
          if (resolvedConfig.startUrls) {
            // Remove placeholder items
            resolvedConfig.startUrls = resolvedConfig.startUrls.filter((item: any) => {
              if (typeof item === "string") {
                return !item.includes("{{");
              }
              if (typeof item === "object" && item.url) {
                return typeof item.url === "string" && !item.url.includes("{{");
              }
              return true;
            });
          }

          // Set startUrls with formatted URLs (overwrite any existing values)
          resolvedConfig.startUrls = formattedUrls;

          // Remove keywords if present (this scraper uses URLs, not keywords)
          delete resolvedConfig.keywords;
          delete resolvedConfig.query;

          input = resolvedConfig;
          console.log(
            `Testing Facebook scraper with ${formattedUrls.length} Facebook URLs, input:`,
            JSON.stringify(input, null, 2)
          );
        } else {
          // Facebook Posts Search - uses keywords
          console.log(
            `Processing Facebook Posts Search scraper with keywords for project: ${projectId}`
          );
          const resolvedConfig = apifyService.resolveFacebookConfigPlaceholders(
            config,
            keywords,
            []
          );
          input = resolvedConfig;
          console.log(`Testing Facebook Posts Search scraper with keywords, input:`, input);
        }
      } else if (hasUrlInput) {
        // Fetch real URLs from DownstreamPost table for testing
        console.log(
          `Fetching URLs from DownstreamPost table for source scraper: ${validatedData.url_input_source_scraper}`
        );
        const urls = await apifyService.fetchUrlsFromDownstreamPosts(
          projectId || "",
          validatedData.url_input_source_scraper!
        );
        console.log(`Found ${urls.length} URLs from DownstreamPost table:`, urls);

        if (urls.length === 0) {
          console.log(
            `No URLs found for source scraper "${validatedData.url_input_source_scraper}". Using mock URLs for testing.`
          );
          const mockUrls = ["https://x.com/example/status/1234567890"];
          const injectedConfig = apifyService.injectUrlsIntoConfig(
            config,
            validatedData.url_input_field_name!,
            mockUrls
          );

          // Discord scrapers expect config at root level, others expect nested
          if (isDiscord(platform)) {
            input = injectedConfig;
          } else {
            input = {
              config: injectedConfig,
              keywords: keywords,
            };
          }
          console.log(`Testing with URL input configuration using mock URLs:`, input);
        } else {
          // Process URLs in batches (configurable)
          const batchSize =
            (await configService.getConfig("performance", "scraper_test_batch_size")) || 5;
          const batches = [];
          for (let i = 0; i < urls.length; i += batchSize) {
            batches.push(urls.slice(i, i + batchSize));
          }

          console.log(
            `Processing ${urls.length} URLs in ${batches.length} batches of ${batchSize}`
          );

          // Process ALL batches iteratively
          for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const currentBatch = batches[batchIndex];
            console.log(
              `Processing batch ${batchIndex + 1}/${batches.length} with ${currentBatch.length} URLs`
            );

            const injectedConfig = apifyService.injectUrlsIntoConfig(
              config,
              validatedData.url_input_field_name!,
              currentBatch
            );

            // Discord scrapers expect config at root level, others expect nested
            if (isDiscord(platform)) {
              input = injectedConfig;
            } else {
              input = {
                config: injectedConfig,
                keywords: keywords,
              };
            }
            console.log(
              `Testing with URL input configuration using batch ${batchIndex + 1} of ${currentBatch.length} real URLs:`,
              input
            );

            // Run the scraper for this batch
            if (shouldSaveResults) {
              console.log(
                `Starting scraper synchronously for batch ${batchIndex + 1}/${batches.length}`
              );
              try {
                // Run the scraper synchronously
                const runResult = await apifyService.runScraperSync(actor_id, input, platform);
                console.log(
                  `Synchronous run completed for batch ${batchIndex + 1}, runId: ${runResult.id}, status: ${runResult.status}`
                );

                // Check if the run has a dataset (even if it timed out, results may be available)
                if (runResult.defaultDatasetId) {
                  console.log(
                    `Fetching dataset items for batch ${batchIndex + 1}, datasetId: ${runResult.defaultDatasetId}`
                  );
                  const items = await apifyService.getDatasetItems(runResult.defaultDatasetId);
                  console.log(`Retrieved ${items.length} items for batch ${batchIndex + 1}`);

                  // Debug: Show first few items if any exist
                  if (items.length > 0) {
                    console.log(
                      `Sample item for batch ${batchIndex + 1}:`,
                      JSON.stringify(items[0], null, 2)
                    );
                  }

                  // Save results for this batch
                  if (!projectId) {
                    console.error(
                      `❌ No project ID provided for test results. Cannot save data for batch ${batchIndex + 1}.`
                    );
                    continue; // Skip this batch if no project ID
                  }

                  console.log(`Using project ID: ${projectId} for batch ${batchIndex + 1}`);
                  console.log(
                    `Save to DB setting: ${validatedData.save_to_db} (will save to ${validatedData.save_to_db ? "Post" : "DownstreamPost"} table)`
                  );
                  const { savedCount } = await apifyService.processAndSavePosts(
                    projectId,
                    null, // No job for test data
                    items,
                    true, // isTest = true for test results
                    platform, // Pass the platform
                    validatedData.name, // scraper name
                    validatedData.save_to_db ?? true // Respect scraper's save_to_db setting for test results
                  );
                  totalItems += savedCount;
                  console.log(
                    `✅ Saved ${savedCount} test items for batch ${batchIndex + 1} to ${validatedData.save_to_db ? "Post" : "DownstreamPost"} table`
                  );
                } else {
                  console.log(
                    `❌ No dataset available for batch ${batchIndex + 1}, status: ${runResult.status}, datasetId: ${runResult.defaultDatasetId}`
                  );
                }

                // Add result for this batch
                results.push({
                  keyword: `Batch ${batchIndex + 1}/${batches.length}`,
                  runId: runResult?.id,
                  success:
                    runResult.status === "SUCCEEDED" ||
                    runResult.status === "READY" ||
                    (runResult.status === "TIMED_OUT" && runResult.defaultDatasetId),
                  status: runResult.status,
                });
              } catch (error) {
                console.error(`❌ Error in synchronous run for batch ${batchIndex + 1}:`, error);
                results.push({
                  keyword: `Batch ${batchIndex + 1}/${batches.length}`,
                  runId: null,
                  success: false,
                  status: "ERROR",
                });
              }
            } else {
              // Just test without saving
              const result = await apifyService.testScraper(actor_id, input);
              results.push({
                keyword: `Batch ${batchIndex + 1}/${batches.length}`,
                runId: result.runId,
                success: result.success,
                status: result.status,
              });
            }
          }

          // Skip the normal processing loop since we've already processed all batches
          continue;
        }
      } else {
        // For keyword-based scrapers, pass all keywords as a single array
        let resolvedConfig;

        // For Reddit scrapers, combine keywords with Reddit URLs
        // For X scrapers, combine keywords with X URLs
        // For LinkedIn scrapers, combine keywords with LinkedIn URLs
        if (platform === "reddit" && projectId) {
          resolvedConfig = await apifyService.resolveRedditConfigPlaceholders(
            config,
            keywords,
            projectId
          );
        } else if (platform === "x" && projectId) {
          resolvedConfig = await apifyService.resolveXConfigPlaceholders(
            config,
            keywords,
            projectId,
            actor_id,
            undefined
          );
        } else if (platform === "linkedin" && projectId) {
          resolvedConfig = await apifyService.resolveLinkedInConfigPlaceholders(
            config,
            keywords,
            projectId
          );
        } else {
          resolvedConfig = apifyService.resolveConfigPlaceholders(config, {
            keyword: testInputItem,
            keywords: keywords, // Pass all keywords as array for Twitter/X scrapers
          });
        }

        // Discord, Reddit, X, LinkedIn, and Facebook scrapers expect config at root level, others expect nested
        if (
          isDiscord(platform) ||
          platform === "reddit" ||
          platform === "x" ||
          platform === "linkedin" ||
          platform === "facebook"
        ) {
          input = resolvedConfig;
        } else {
          input = {
            config: resolvedConfig,
            keywords: keywords,
          };
        }
        console.log(
          `Testing ${platform === "reddit" && testInputItem === "reddit-all-keywords" ? "Reddit scraper with all keywords" : `keyword "${testInputItem}"`} with input:`,
          input
        );
      }

      let result;

      if (shouldSaveResults) {
        // Run synchronously with 5-minute timeout
        const testLabel = hasUrlInput
          ? "URL input test"
          : platform === "reddit" && testInputItem === "reddit-all-keywords"
            ? "Reddit scraper with all keywords"
            : `keyword "${testInputItem}"`;
        console.log(`Starting scraper synchronously for ${testLabel}`);
        try {
          const runResult = await apifyService.runScraperSync(actor_id, input, platform);
          console.log(
            `Synchronous run completed for ${testLabel}, runId: ${runResult.id}, status: ${runResult.status}`
          );

          // Check if the run has a dataset (even if it timed out, results may be available)
          if (runResult.defaultDatasetId) {
            console.log(
              `Fetching dataset items for ${testLabel}, datasetId: ${runResult.defaultDatasetId}`
            );
            const items = await apifyService.getDatasetItems(runResult.defaultDatasetId);
            console.log(`Retrieved ${items.length} items for ${testLabel}`);

            // Debug: Show first few items if any exist
            if (items.length > 0) {
              console.log(`Sample item for ${testLabel}:`, JSON.stringify(items[0], null, 2));
            }

            // For test results, save with real project ID and isTest=true
            // Discord scrapers can save test results without a project ID
            if (!projectId && !isDiscord(platform)) {
              console.error(`❌ No project ID provided for test results. Cannot save data.`);
              continue; // Skip this test input if no project ID (except for Discord)
            }

            console.log(
              `Using project ID: ${projectId || "null (Discord scraper)"} for ${testLabel}`
            );
            console.log(
              `Save to DB setting: ${validatedData.save_to_db} (will save to ${validatedData.save_to_db ? "Post" : "DownstreamPost"} table)`
            );
            const { savedCount } = await apifyService.processAndSavePosts(
              projectId || "", // Provide empty string fallback for Discord scrapers
              null, // No job for test data
              items,
              true, // isTest = true for test results
              platform, // Pass the platform
              validatedData.name, // scraper name
              validatedData.save_to_db ?? true // Respect scraper's save_to_db setting for test results
            );
            totalItems += savedCount;
            console.log(
              `✅ Saved ${savedCount} test items for ${testLabel} to ${validatedData.save_to_db ? "Post" : "DownstreamPost"} table`
            );
          } else {
            console.log(
              `❌ No dataset available for ${testLabel}, status: ${runResult.status}, datasetId: ${runResult.defaultDatasetId}`
            );
          }

          // Return result for the test
          result = { success: true, runId: runResult?.id, status: runResult.status };
        } catch (error) {
          console.error(`❌ Error in synchronous run for ${testLabel}:`, error);
          result = {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error occurred",
          };
        }
      } else {
        // Just test without saving
        result = await apifyService.testScraper(actor_id, input);
      }

      results.push({
        keyword: hasUrlInput ? "URL input test" : testInputItem,
        runId: result.runId,
        success: result.success,
        status: result.status,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Started ${results.length} test run(s)${saveTestResults ? ` and saved ${totalItems} items` : ""}`,
      results,
      totalKeywords: keywords.length,
      totalItems,
      savedToDatabase: saveTestResults,
      ...(isDiscord(platform) && {
        totalUrls: testDiscordUrls?.length || 0,
        successfulRuns: results.filter((r: any) => !r.error).length,
        failedRuns: results.filter((r: any) => r.error).length,
      }),
    });
  } catch (error) {
    console.error("Error testing scraper:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}
