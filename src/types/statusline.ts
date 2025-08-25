export type StatusLineInput = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  transcript_path: string;
  version: string;
  workspace: {
    current_dir: string;
    project_dir: string;
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
  exceeds_200k_tokens: boolean;
};
