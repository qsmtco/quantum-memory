/**
 * Quantum Memory - Projects Tool
 * 
 * Lists and manages projects in Quantum Memory.
 */

import { Type } from "@sinclair/typebox";

/**
 * Projects tool input schema
 */
export const QmProjectsSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("create"),
  ], {
    description: "Action: list all, get one, or create new",
  }),
  projectId: Type.Optional(
    Type.String({ description: "Project ID (for get action)" })
  ),
  name: Type.Optional(
    Type.String({ description: "Project name (for create action)" })
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum results for list (default: 50)",
      minimum: 1,
      maximum: 200,
    })
  ),
});

/**
 * Create projects tool for Quantum Memory
 */
export function createQmProjectsTool(deps: {
  projectManager: any;
}) {
  return {
    name: "qm_projects",
    description: "List, get, or create projects in Quantum Memory",
    inputSchema: QmProjectsSchema,
    
    async execute(input: {
      action: "list" | "get" | "create";
      projectId?: string;
      name?: string;
      limit?: number;
    }) {
      const limit = Math.min(input.limit ?? 50, 200);
      
      switch (input.action) {
        case "list": {
          const projects = deps.projectManager.list(limit);
          return { projects, total: projects.length };
        }
        case "get": {
          if (!input.projectId) {
            return { error: "projectId required for get action" };
          }
          const project = deps.projectManager.get(input.projectId);
          return { project: project ?? null };
        }
        case "create": {
          if (!input.name) {
            return { error: "name required for create action" };
          }
          const project = deps.projectManager.create(input.name);
          return { project, created: true };
        }
        default:
          return { error: "Unknown action" };
      }
    },
  };
}
