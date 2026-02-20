export type StatusLineInput = {
  hook_event_name: string;
  session_id: string;
  // human-readable session name set via /rename (optional)
  session_name?: string;
  cwd: string;
  transcript_path: string;
  version: string;
  workspace: {
    current_dir: string;
    project_dir: string;
    // directories added via /add-dir (v2.1.47)
    added_dirs: string[];
  };
  model: {
    id: string;
    display_name: string;
  };
  output_style: {
    name: string;
  };
  cost: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  // token usage info for the current session
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    } | null;
    used_percentage: number | null;
    remaining_percentage: number | null;
  };
  exceeds_200k_tokens: boolean;
  // only present when vim mode is enabled
  vim?: {
    mode: "INSERT" | "NORMAL";
  };
  // only present when started with --agent flag
  agent?: {
    name: string;
  };
};
