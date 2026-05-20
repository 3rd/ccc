export type StatusLineInput = {
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
    // present when cwd is in a linked git worktree
    git_worktree?: string;
    // repository identity from the origin remote (v2.1.145)
    repo?: {
      host: string;
      owner: string;
      name: string;
    };
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
  // claude.ai subscription usage limits; only present for subscribers after first API response (v2.1.80)
  rate_limits?: {
    five_hour?: {
      used_percentage: number;
      resets_at: number;
    };
    seven_day?: {
      used_percentage: number;
      resets_at: number;
    };
  };
  exceeds_200k_tokens: boolean;
  // only present when vim mode is enabled
  vim?: {
    mode: "INSERT" | "NORMAL" | "VISUAL" | "VISUAL LINE";
  };
  // main thread agent type name (from --agent flag or agent type)
  agent_type?: string;
  // only present when started with --agent flag
  agent?: {
    name: string;
  };
  // only present in remote mode
  remote?: {
    session_id: string;
  };
  // open PR for the current branch; mirrors the footer PR badge (v2.1.145)
  pr?: {
    number: number;
    url: string;
    review_state?: "approved" | "changes_requested" | "draft" | "pending";
  };
  // only present when running in a git worktree
  worktree?: {
    name: string;
    path: string;
    branch: string;
    original_cwd: string;
    original_branch: string;
  };
};
