export interface ScraperFormData {
  name: string;
  descriptive_name: string;
  actor_id: string;
  readme_url: string;
  platform: string;
  config_json: string;
  is_active: boolean;
  save_to_db: boolean;
  input_type: string;
  run_iteratively: boolean;
  url_input_field_name: string;
  url_input_source_scraper: string;
}

export interface Scraper {
  id: string;
  name: string;
  descriptive_name: string;
  actor_id: string;
  readme_url: string | null;
  platform: string;
  config_json: string;
  is_active: boolean;
  save_to_db: boolean;
  input_type: string;
  run_iteratively: boolean;
  url_input_field_name: string | null;
  url_input_source_scraper: string | null;
}

export interface CreateScraperFormProps {
  scraper?: Scraper;
}
