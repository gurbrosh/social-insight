// Import prisma directly - the circular dependency issue was elsewhere
import { prisma } from "@/lib/prisma";

export interface ConfigValue {
  value: any;
  dataType: string;
  minValue?: number;
  maxValue?: number;
  options?: string[];
  section?: string;
}

export interface ConfigSection {
  [key: string]: ConfigValue;
}

export interface AppConfiguration {
  scraping: ConfigSection;
  api: ConfigSection;
  performance: ConfigSection;
  ui: ConfigSection;
  platform: ConfigSection;
}

class ConfigService {
  private cache: Map<string, any> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get a configuration value by category and key
   */
  async getConfig(category: string, key: string): Promise<any> {
    const cacheKey = `${category}.${key}`;
    const now = Date.now();

    // Check cache first
    if (this.cache.has(cacheKey) && this.cacheExpiry.get(cacheKey)! > now) {
      return this.cache.get(cacheKey);
    }

    try {
      const config = await prisma.appConfig.findFirst({
        where: {
          category,
          key,
          deleted_at: null,
        },
      });

      if (!config) {
        console.warn(`Configuration not found: ${category}.${key}`);
        return null;
      }

      // Parse value based on data type
      let parsedValue: any;
      switch (config.data_type) {
        case "number":
          parsedValue = parseFloat(config.value);
          break;
        case "boolean":
          parsedValue = config.value === "true";
          break;
        case "object":
        case "array":
          parsedValue = JSON.parse(config.value);
          break;
        default:
          parsedValue = config.value;
      }

      // Cache the result
      this.cache.set(cacheKey, parsedValue);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL);

      return parsedValue;
    } catch (error) {
      console.error(`Error getting config ${category}.${key}:`, error);
      return null;
    }
  }

  /**
   * Get all configuration values for a category
   */
  async getCategoryConfig(category: string): Promise<ConfigSection> {
    const cacheKey = `category.${category}`;
    const now = Date.now();

    // Check cache first
    if (this.cache.has(cacheKey) && this.cacheExpiry.get(cacheKey)! > now) {
      return this.cache.get(cacheKey);
    }

    try {
      const configs = await prisma.appConfig.findMany({
        where: {
          category,
          deleted_at: null,
        },
        orderBy: { order: "asc" },
      });

      const result: ConfigSection = {};
      for (const config of configs) {
        let parsedValue: any;
        switch (config.data_type) {
          case "number":
            parsedValue = parseFloat(config.value);
            break;
          case "boolean":
            parsedValue = config.value === "true";
            break;
          case "object":
          case "array":
            parsedValue = JSON.parse(config.value);
            break;
          default:
            parsedValue = config.value;
        }

        result[config.key] = {
          value: parsedValue,
          dataType: config.data_type,
          minValue: config.min_value || undefined,
          maxValue: config.max_value || undefined,
          options: config.options ? JSON.parse(config.options) : undefined,
        };
      }

      // Cache the result
      this.cache.set(cacheKey, result);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL);

      return result;
    } catch (error) {
      console.error(`Error getting category config ${category}:`, error);
      return {};
    }
  }

  /**
   * Get all configuration values
   */
  async getAllConfig(): Promise<AppConfiguration> {
    const categories = ["scraping", "api", "performance", "ui", "platform"];
    const result: AppConfiguration = {} as AppConfiguration;

    for (const category of categories) {
      result[category as keyof AppConfiguration] = await this.getCategoryConfig(category);
    }

    return result;
  }

  /**
   * Set a configuration value
   */
  async setConfig(
    category: string,
    key: string,
    value: any,
    dataType: string,
    options?: {
      description?: string;
      displayName?: string;
      section?: string;
      order?: number;
      minValue?: number;
      maxValue?: number;
      options?: string[];
    }
  ): Promise<boolean> {
    try {
      // Serialize value based on data type
      let serializedValue: string;
      switch (dataType) {
        case "object":
        case "array":
          serializedValue = JSON.stringify(value);
          break;
        default:
          serializedValue = String(value);
      }

      await prisma.appConfig.upsert({
        where: {
          category_key: {
            category,
            key,
          },
        },
        update: {
          value: serializedValue,
          data_type: dataType,
          description: options?.description,
          display_name: options?.displayName,
          section: options?.section,
          order: options?.order,
          min_value: options?.minValue,
          max_value: options?.maxValue,
          options: options?.options ? JSON.stringify(options.options) : null,
          updated_at: new Date(),
        },
        create: {
          category,
          key,
          value: serializedValue,
          data_type: dataType,
          description: options?.description,
          display_name: options?.displayName,
          section: options?.section,
          order: options?.order,
          min_value: options?.minValue,
          max_value: options?.maxValue,
          options: options?.options ? JSON.stringify(options.options) : null,
        },
      });

      // Clear cache
      this.clearCache();

      return true;
    } catch (error) {
      console.error(`Error setting config ${category}.${key}:`, error);
      return false;
    }
  }

  /**
   * Clear the configuration cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry.clear();
  }

  /**
   * Initialize default configuration values
   */
  async initializeDefaults(): Promise<void> {
    const defaultConfigs = [
      // Scraping Configuration
      {
        category: "scraping",
        key: "reddit_timeout",
        value: 1800,
        dataType: "number",
        displayName: "Reddit Timeout (seconds)",
        description: "Timeout for Reddit scraping operations",
        minValue: 60,
        maxValue: 7200,
        section: "Timeouts",
        order: 1,
      },
      {
        category: "scraping",
        key: "twitter_timeout",
        value: 180,
        dataType: "number",
        displayName: "Twitter/X Timeout (seconds)",
        description: "Timeout for Twitter/X scraping operations",
        minValue: 30,
        maxValue: 1800,
        section: "Timeouts",
        order: 2,
      },
      {
        category: "scraping",
        key: "linkedin_timeout",
        value: 3600,
        dataType: "number",
        displayName: "LinkedIn Timeout (seconds)",
        description: "Timeout for LinkedIn scraping operations",
        minValue: 60,
        maxValue: 7200,
        section: "Timeouts",
        order: 3,
      },
      {
        category: "scraping",
        key: "discord_timeout",
        value: 3600,
        dataType: "number",
        displayName: "Discord Timeout (seconds)",
        description: "Timeout for Discord scraping operations",
        minValue: 60,
        maxValue: 7200,
        section: "Timeouts",
        order: 4,
      },
      {
        category: "scraping",
        key: "facebook_timeout",
        value: 3600,
        dataType: "number",
        displayName: "Facebook Timeout (seconds)",
        description: "Timeout for Facebook scraping operations",
        minValue: 60,
        maxValue: 7200,
        section: "Timeouts",
        order: 5,
      },
      {
        category: "scraping",
        key: "default_timeout",
        value: 3600,
        dataType: "number",
        displayName: "Default Timeout (seconds)",
        description: "Default timeout for scraping operations",
        minValue: 60,
        maxValue: 7200,
        section: "Timeouts",
        order: 6,
      },

      // Performance Configuration
      {
        category: "performance",
        key: "sentiment_batch_size",
        value: 5,
        dataType: "number",
        displayName: "Sentiment Analysis Batch Size",
        description: "Number of posts to process in each sentiment analysis batch",
        minValue: 1,
        maxValue: 50,
        section: "Batch Processing",
        order: 1,
      },
      {
        category: "performance",
        key: "scraper_test_batch_size",
        value: 5,
        dataType: "number",
        displayName: "Scraper Test Batch Size",
        description: "Number of URLs to process in each scraper test batch",
        minValue: 1,
        maxValue: 20,
        section: "Batch Processing",
        order: 2,
      },
      {
        category: "performance",
        key: "job_status_polling_interval",
        value: 10000,
        dataType: "number",
        displayName: "Job Status Polling Interval (ms)",
        description: "How often to check job status during orchestration",
        minValue: 1000,
        maxValue: 60000,
        section: "Polling",
        order: 3,
      },
      {
        category: "performance",
        key: "apify_status_polling_interval",
        value: 30000,
        dataType: "number",
        displayName: "Apify Status Polling Interval (ms)",
        description: "How often to check Apify job status",
        minValue: 5000,
        maxValue: 120000,
        section: "Polling",
        order: 4,
      },
      {
        category: "performance",
        key: "retry_delay",
        value: 2000,
        dataType: "number",
        displayName: "Retry Delay (ms)",
        description: "Delay between retry attempts",
        minValue: 500,
        maxValue: 10000,
        section: "Polling",
        order: 5,
      },
      {
        category: "performance",
        key: "sentiment_batch_delay",
        value: 1000,
        dataType: "number",
        displayName: "Sentiment Batch Delay (ms)",
        description: "Delay between sentiment analysis batches",
        minValue: 100,
        maxValue: 5000,
        section: "Rate Limiting",
        order: 6,
      },
      {
        category: "performance",
        key: "api_call_delay",
        value: 2000,
        dataType: "number",
        displayName: "API Call Delay (ms)",
        description: "Delay between API calls",
        minValue: 100,
        maxValue: 10000,
        section: "Rate Limiting",
        order: 7,
      },

      // API Configuration
      {
        category: "api",
        key: "apify_base_url",
        value: "https://api.apify.com/v2",
        dataType: "string",
        displayName: "Apify Base URL",
        description: "Base URL for Apify API",
        section: "Endpoints",
        order: 1,
      },
      {
        category: "api",
        key: "openai_base_url",
        value: "https://api.openai.com/v1",
        dataType: "string",
        displayName: "OpenAI Base URL",
        description: "Base URL for OpenAI API",
        section: "Endpoints",
        order: 2,
      },
      {
        category: "api",
        key: "crunchycone_base_url",
        value: "https://api.crunchycone.dev",
        dataType: "string",
        displayName: "CrunchyCone Base URL",
        description: "Base URL for CrunchyCone API",
        section: "Endpoints",
        order: 3,
      },
      {
        category: "api",
        key: "apify_timeout",
        value: 30000,
        dataType: "number",
        displayName: "Apify API Timeout (ms)",
        description: "Timeout for Apify API calls",
        minValue: 5000,
        maxValue: 120000,
        section: "Timeouts",
        order: 4,
      },
      {
        category: "api",
        key: "openai_timeout",
        value: 30000,
        dataType: "number",
        displayName: "OpenAI API Timeout (ms)",
        description: "Timeout for OpenAI API calls",
        minValue: 5000,
        maxValue: 120000,
        section: "Timeouts",
        order: 5,
      },
      {
        category: "api",
        key: "crunchycone_timeout",
        value: 30000,
        dataType: "number",
        displayName: "CrunchyCone API Timeout (ms)",
        description: "Timeout for CrunchyCone API calls",
        minValue: 5000,
        maxValue: 120000,
        section: "Timeouts",
        order: 6,
      },

      // UI Configuration
      {
        category: "ui",
        key: "copy_feedback_duration",
        value: 2000,
        dataType: "number",
        displayName: "Copy Feedback Duration (ms)",
        description: "How long to show copy success feedback",
        minValue: 500,
        maxValue: 5000,
        section: "Feedback",
        order: 1,
      },
      {
        category: "ui",
        key: "flash_effect_duration",
        value: 2000,
        dataType: "number",
        displayName: "Flash Effect Duration (ms)",
        description: "How long to show flash effects",
        minValue: 500,
        maxValue: 5000,
        section: "Feedback",
        order: 2,
      },
      {
        category: "ui",
        key: "browser_open_delay",
        value: 1000,
        dataType: "number",
        displayName: "Browser Open Delay (ms)",
        description: "Delay before opening browser in development",
        minValue: 0,
        maxValue: 5000,
        section: "Development",
        order: 3,
      },
      {
        category: "ui",
        key: "auth_check_delay",
        value: 100,
        dataType: "number",
        displayName: "Auth Check Delay (ms)",
        description: "Delay for authentication checks",
        minValue: 0,
        maxValue: 1000,
        section: "Development",
        order: 4,
      },
      {
        category: "ui",
        key: "provider_check_delay",
        value: 100,
        dataType: "number",
        displayName: "Provider Check Delay (ms)",
        description: "Delay for provider availability checks",
        minValue: 0,
        maxValue: 1000,
        section: "Development",
        order: 5,
      },
      {
        category: "ui",
        key: "admin_setup_delay",
        value: 1500,
        dataType: "number",
        displayName: "Admin Setup Delay (ms)",
        description: "Delay after admin setup completion",
        minValue: 500,
        maxValue: 5000,
        section: "Setup",
        order: 6,
      },

      // Platform Configuration
      {
        category: "performance",
        key: "use_task_based_analysis",
        value: true,
        dataType: "boolean",
        displayName: "Use Task-Based Analysis",
        description:
          "Reflects the analysis pipeline mode in admin UI. Orchestration uses OrchestrationRun/RunRecord/AnalysisTask (task-based path); legacy cursor mode is deprecated.",
        section: "Analysis",
        order: 8,
      },
      {
        category: "platform",
        key: "supported_platforms",
        value: ["reddit", "x", "twitter", "linkedin", "discord", "facebook"],
        dataType: "array",
        displayName: "Supported Platforms",
        description: "List of supported scraping platforms",
        section: "Platforms",
        order: 1,
      },
      {
        category: "platform",
        key: "platform_aliases",
        value: { x: "twitter", X: "twitter" },
        dataType: "object",
        displayName: "Platform Aliases",
        description: "Platform name aliases for normalization",
        section: "Platforms",
        order: 2,
      },
    ];

    for (const config of defaultConfigs) {
      await this.setConfig(config.category, config.key, config.value, config.dataType, {
        displayName: config.displayName,
        description: config.description,
        section: config.section,
        order: config.order,
        minValue: config.minValue,
        maxValue: config.maxValue,
      });
    }
  }
}

export const configService = new ConfigService();
