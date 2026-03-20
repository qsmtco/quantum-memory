/**
 * quantum-memory - Context Engine Plugin for OpenClaw
 *
 * Hybrid memory system with DAG compaction, entity extraction,
 * knowledge graph, auto-recall, and smart dropping.
 *
 * @see https://github.com/qsmtco/quantum-memory
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerQuantumMemory } from "../engine/QuantumEngine.js";
import { registerQmTools } from "./tools.js";

/**
 * Plugin registration function
 * Called by OpenClaw when the plugin loads
 *
 * @param api - OpenClaw plugin API providing context engine registration
 */
export default function quantumMemoryPlugin(api: OpenClawPluginApi): void {
  // Register context engine - this is the core functionality
  const engine = registerQuantumMemory(api);

  // Register QM tools as optional OpenClaw agent tools
  // Tools: qm_search, qm_entities, qm_relations, qm_recall, qm_projects
  // Users must add these to their agent's tools.allow list to use them.
  // See: https://docs.openclaw.ai/plugins/agent-tools#optional-tool-opt-in
  registerQmTools(api, {
    searchEngine: engine.searchEngine,
    sessionIdGetter: () => engine.getCurrentSessionId(),
    entityStore: engine.entityStore,
    relationStore: engine.relationStore,
    memoryInjectStore: engine.memoryInjectStore,
    sessionStore: engine.sessionManager,
    projectManager: engine.projectManager,
  });

  console.log("[QuantumMemory] Context engine + tools registered");
}
