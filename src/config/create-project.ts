import type { CreateProjectOptions, ProjectMetadata } from "@/types/project";

export function createProject(options: CreateProjectOptions): ProjectMetadata {
  return {
    name: options.name,
    description: options.description,
    root: options.root,
    disableParentClaudeMds: options.disableParentClaudeMds,
  };
}
