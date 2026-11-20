import type { BetaMessage, LlmClient, MessageCreateParamsNonStreaming } from '../services/ai/llm.ts';

type Step = (params: MessageCreateParamsNonStreaming) => Partial<BetaMessage> & Pick<BetaMessage, 'content' | 'stop_reason'>;

/**
 * A scripted stand-in for the model: each call consumes the next step. Records every request so tests
 * can assert exactly what MandiMitra sends (model, tools, fallbacks, history replay, tenant data).
 */
export class ScriptedLlm implements LlmClient {
  readonly enabled = true;
  readonly calls: MessageCreateParamsNonStreaming[] = [];
  private steps: Step[] = [];

  script(...steps: Step[]) {
    this.steps.push(...steps);
    return this;
  }

  async create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> {
    this.calls.push(structuredClone(params));
    const step = this.steps.shift();
    if (!step) throw new Error('ScriptedLlm: no step left');
    const r = step(params);
    return {
      id: `msg_${this.calls.length}`,
      type: 'message',
      role: 'assistant',
      model: String(params.model),
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
      ...r,
    } as unknown as BetaMessage;
  }
}

export const text = (t: string): Step => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t, citations: null }] as never });

export const toolCall = (name: string, input: Record<string, unknown>, id = `toolu_${Math.random().toString(36).slice(2, 10)}`): Step => () => ({
  stop_reason: 'tool_use',
  content: [
    // A thinking block with a signature: must be replayed unchanged in later requests.
    { type: 'thinking', thinking: '', signature: `sig-${id}` },
    { type: 'tool_use', id, name, input },
  ] as never,
});

/** The tool_result blocks sent back to the model in the latest request, parsed. */
export function lastToolResults(params: MessageCreateParamsNonStreaming) {
  const last = params.messages.at(-1)!;
  const blocks = Array.isArray(last.content) ? last.content : [];
  return blocks
    .filter((b) => (b as { type: string }).type === 'tool_result')
    .map((b) => {
      const tr = b as { content: string; is_error?: boolean; tool_use_id: string };
      return { id: tr.tool_use_id, isError: !!tr.is_error, data: JSON.parse(tr.content) as unknown };
    });
}
