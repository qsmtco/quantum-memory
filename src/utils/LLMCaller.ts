/**
 * LLM Integration utilities for Quantum Memory
 * 
 * This module provides utilities for calling LLMs through OpenClaw's tool system.
 * The plugin receives access to LLM tools via the context parameter passed to tools/hooks.
 * 
 * Supported LLM tools (in order of preference):
 * - chat_completion
 * - generate
 * - llm
 * - openai
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  /** Model to use (optional - uses default if not specified) */
  model?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature for sampling (0-2) */
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * LLMCaller - wrapper for calling LLM through OpenClaw's tool system
 * 
 * Usage:
 * const caller = new LLMCaller(ctx.tools);
 * const response = await caller.chat([{ role: 'user', content: 'Hello' }]);
 */
export class LLMCaller {
  private llmTool: ((params: any) => Promise<any>) | null = null;
  private toolName: string | null = null;

  /**
   * @param tools - OpenClaw tools object (from ctx.tools)
   */
  constructor(tools: Record<string, any> | undefined) {
    if (!tools) {
      console.warn('[LLMCaller] No tools provided - LLM calls will fail');
      return;
    }

    // Find available LLM tool (in order of preference)
    const toolNames = ['chat_completion', 'generate', 'llm', 'openai'];
    for (const name of toolNames) {
      if (tools[name]) {
        this.llmTool = tools[name];
        this.toolName = name;
        console.log(`[LLMCaller] Using LLM tool: ${name}`);
        break;
      }
    }

    if (!this.llmTool) {
      console.warn('[LLMCaller] No LLM tool found. Available tools:', Object.keys(tools));
    }
  }

  /**
   * Check if LLM is available
   */
  isAvailable(): boolean {
    return this.llmTool !== null;
  }

  /**
   * Get the name of the LLM tool being used
   */
  getToolName(): string | null {
    return this.toolName;
  }

  /**
   * Call LLM with chat messages (OpenAI-style interface)
   * 
   * @param messages - Array of messages with role and content
   * @param options - Optional configuration
   * @returns LLM response content
   */
  async chat(messages: LLMMessage[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    if (!this.llmTool) {
      throw new Error('LLM tool not available. Initialize with tools from OpenClaw context.');
    }

    try {
      // Format messages based on tool
      const requestBody = this.formatRequest(messages, options);
      
      // Make the call with timeout
      const response = await Promise.race([
        this.llmTool(requestBody),
        this.createTimeout(60000), // 60 second timeout
      ]);

      return this.parseResponse(response);
    } catch (error) {
      console.error('[LLMCaller] LLM call failed:', error);
      throw error;
    }
  }

  /**
   * Simple prompt-based generation
   * 
   * @param prompt - User prompt
   * @param systemPrompt - Optional system prompt
   * @param options - Optional configuration
   * @returns LLM response content
   */
  async generate(prompt: string, systemPrompt?: string, options: LLMCallOptions = {}): Promise<LLMResponse> {
    const messages: LLMMessage[] = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    return this.chat(messages, options);
  }

  /**
   * Summarize text using LLM
   * 
   * @param text - Text to summarize
   * @param maxTokens - Maximum tokens in summary
   * @returns Summarized text
   */
  async summarize(text: string, maxTokens: number = 500): Promise<string> {
    const systemPrompt = `You are a helpful assistant that summarizes conversations concisely while preserving key information:
- Keep important names, decisions, and technical details
- Preserve context needed to continue the conversation
- Use bullet points for multiple items
- Keep it under ${maxTokens} tokens`;

    const response = await this.generate(
      `Summarize this conversation:\n\n${text}`,
      systemPrompt,
      { maxTokens }
    );

    return response.content;
  }

  /**
   * Format request based on available tool
   */
  private formatRequest(messages: LLMMessage[], options: LLMCallOptions): any {
    const base = {
      messages,
      ...(options.model && { model: options.model }),
      ...(options.maxTokens && { max_tokens: options.maxTokens }),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
    };

    // Different tools have different parameter formats
    switch (this.toolName) {
      case 'chat_completion':
        return base;
      case 'generate':
        return { prompt: messages[messages.length - 1].content, ...base };
      case 'llm':
      case 'openai':
      default:
        return base;
    }
  }

  /**
   * Parse response from LLM tool
   */
  private parseResponse(response: any): LLMResponse {
    // Try different response formats
    if (response.choices?.[0]?.message?.content) {
      // OpenAI format
      return {
        content: response.choices[0].message.content,
        model: response.model,
        usage: response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        } : undefined,
      };
    }

    if (response.content) {
      // Direct content
      return { content: response.content, model: response.model };
    }

    if (response.text) {
      // Alternative format
      return { content: response.text, model: response.model };
    }

    if (typeof response === 'string') {
      // Plain string
      return { content: response };
    }

    // Fallback: stringify
    console.warn('[LLMCaller] Unexpected response format:', JSON.stringify(response).slice(0, 200));
    return { content: JSON.stringify(response) };
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms)
    );
  }
}

/**
 * Create LLMCaller from OpenClaw context
 * 
 * @param ctx - OpenClaw context (tools available in tool implementations)
 * @returns LLMCaller instance
 * 
 * @example
 * // In a tool implementation:
 * export const myTool = {
 *   schema: { ... },
 *   impl: async (params, ctx) => {
 *     const llm = createLLMCaller(ctx.tools);
 *     if (!llm.isAvailable()) {
 *       throw new Error('LLM not available');
 *     }
 *     const result = await llm.chat([{ role: 'user', content: 'Hello' }]);
 *     return result.content;
 *   }
 * };
 */
export function createLLMCaller(tools: Record<string, any> | undefined): LLMCaller {
  return new LLMCaller(tools);
}
