// Quantum Memory - OpenClaw Plugin Entry Point
import { registerQuantumMemory } from './engine/QuantumEngine.js';

/**
 * OpenClaw plugin registration
 * 
 * This function is called by OpenClaw when the plugin loads.
 * It registers the Quantum Memory context engine.
 */
export default function register(api: {
  registerContextEngine: (id: string, factory: () => any) => void;
}): void {
  registerQuantumMemory(api);
}

// Export for direct usage
export { QuantumContextEngine } from './engine/QuantumEngine.js';
export { getDatabase, closeDatabase } from './db/Database.js';
