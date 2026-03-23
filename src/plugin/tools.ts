/**
 * Quantum Memory - OpenClaw Tool Adapters
 * 
 * Adapts QM tool factories to OpenClaw's AgentTool format.
 * OpenClaw tools use: { name, description, parameters, execute(id, params) }
 * QM tools use: { name, description, inputSchema, execute(input) }
 * 
 * Reference: https://docs.openclaw.ai/plugins/agent-tools
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AnyAgentTool } from "openclaw/plugin-sdk";

import { createQmSearchTool } from "../tools/qm-search-tool.js";
import { createQmEntitiesTool } from "../tools/qm-entities-tool.js";
import { createQmRelationsTool } from "../tools/qm-relations-tool.js";
import { createQmRecallTool } from "../tools/qm-recall-tool.js";
import { createQmProjectsTool } from "../tools/qm-projects-tool.js";
import { createQmLineageTool } from "../tools/qm-lineage-tool.js";

/**
 * Wraps a QM tool factory result into an OpenClaw-compatible AgentTool.
 * The execute result is serialized as a JSON text block.
 */
function adaptTool(qmTool: {
  name: string;
  description: string;
  inputSchema: any;
  execute: (input: any) => any;
}): AnyAgentTool {
  return {
    name: qmTool.name,
    label: qmTool.name,
    description: qmTool.description,
    parameters: qmTool.inputSchema,
    async execute(_id: string, params: any) {
      const result = await qmTool.execute(params);
      // OpenClaw expects { content: [{ type: "text", text: string }], details: ... }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        details: {},
      };
    },
  };
}

/**
 * Register all QM tools with the OpenClaw plugin API.
 * Tools are registered as optional (user must opt-in via allowlist).
 */
export function registerQmTools(api: OpenClawPluginApi, deps: {
  searchEngine: any;
  sessionIdGetter: () => string;
  entityStore: any;
  relationStore: any;
  memoryInjectStore: any;
  sessionStore: any;
  projectManager: any;
  lineageTraverser: any;  // Phase 3.3: For qm_lineage tool
}): void {
  const tools: AnyAgentTool[] = [
    adaptTool(createQmSearchTool({
      searchEngine: deps.searchEngine,
      sessionIdGetter: deps.sessionIdGetter,
    })),
    adaptTool(createQmEntitiesTool({
      entityStore: deps.entityStore,
      sessionIdGetter: deps.sessionIdGetter,
    })),
    adaptTool(createQmRelationsTool({
      relationStore: deps.relationStore,
      sessionIdGetter: deps.sessionIdGetter,
    })),
    // Phase 0.2 fix: qm_recall now uses SearchEngine, not MemoryInjectStore
    adaptTool(createQmRecallTool({
      searchEngine: deps.searchEngine,
      sessionIdGetter: deps.sessionIdGetter,
    })),
    adaptTool(createQmProjectsTool({
      projectManager: deps.projectManager,
    })),
    // Phase 3.3: qm_lineage tool for DAG traversal
    adaptTool(createQmLineageTool({
      lineageTraverser: deps.lineageTraverser,
      sessionIdGetter: deps.sessionIdGetter,
    })),
  ];

  for (const tool of tools) {
    // Register each tool as optional — user must add to allowlist
    // See: https://docs.openclaw.ai/plugins/agent-tools#optional-tool-opt-in
    api.registerTool(tool, { optional: true });
  }
}
