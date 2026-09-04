// closed set the cli reports as a prompt-cache miss cause (v2.1.260)
export type PromptCacheMissCause =
  | "system_prompt_changed"
  | "tools_changed"
  | "model_changed"
  | "fast_mode_changed"
  | "cache_scope_or_ttl_changed"
  | "betas_changed"
  | "effort_changed"
  | "auto_mode_changed"
  | "overage_changed"
  | "extra_body_changed"
  | "defer_loading_changed"
  | "messages_rewritten"
  | "ttl_expired_5m"
  | "ttl_expired_1h"
  | "likely_server_side"
  | "unknown";

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
    // behind a Claude gateway, the fullest spend limit; used_percentage can
    // exceed 100 once exceeded (v2.1.251)
    spend_limit?: {
      used_percentage: number;
      resets_at: number;
    };
  };
  // per-session prompt-cache state; absent before the first API request (v2.1.251)
  prompt_cache?: {
    warm: boolean;
    caching_observed: boolean;
    ttl: "5m" | "1h";
    // unix epoch seconds; null when the cache never warmed
    expires_at: number | null;
    requests: number;
    misses: number;
    expected_rebuilds: number;
    // null before any response reported cache tokens (v2.1.260)
    hit_ratio: number | null;
    cache_write_tokens: number;
    // tokens re-cached on unexpected misses
    miss_recache_tokens: number;
    // unix epoch seconds; null when no miss occurred
    last_miss_at: number | null;
    // client-side heuristic for the most recent miss; null when none was diagnosed (v2.1.260)
    last_miss_cause: {
      causes: PromptCacheMissCause[];
      tools_added?: number;
      tools_removed?: number;
      system_char_delta?: number;
    } | null;
    // misses per diagnosed cause this session (v2.1.260)
    miss_causes: Partial<Record<PromptCacheMissCause, number>>;
    // tokens the next request would re-cache if the cache went cold; null right after a compaction (v2.1.260)
    recache_tokens_if_cold: number | null;
  };
  exceeds_200k_tokens: boolean;
  fast_mode: boolean;
  thinking: {
    enabled: boolean;
  };
  // effective effort for the turn (/effort override ?? model catalog default_effort);
  // only present when the current model supports effort (v2.1.219)
  effort?: {
    level: "low" | "medium" | "high" | "xhigh" | "max";
  };
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
  // open PR/MR for the current branch; mirrors the footer badge (v2.1.145)
  pr?: {
    number: number;
    url: string;
    review_state?: "approved" | "changes_requested" | "draft" | "pending";
    // "mr" for GitLab merge requests (glab CLI, v2.1.234); absent or "pr" for GitHub
    kind?: "mr" | "pr";
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
