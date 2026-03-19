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

/**
 * Plugin registration function
 * Called by OpenClaw when the plugin loads
 * 
 * @param api - OpenClaw plugin API providing context engine registration
 */
export default function quantumMemoryPlugin(api: OpenClawPluginApi): void {
  // Register context engine - this is the core functionality
  registerQuantumMemory(api);
  
  // Tools will be registered after full integration with OpenClaw SDK
  // Following lossless-claw pattern with registerTool API
  // Tools: qm_search, qm_entities, qm_relations, qm_recall, qm_projects
  
  console.log("[QuantumMemory] Context engine registered");
}
