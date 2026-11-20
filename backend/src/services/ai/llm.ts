import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/**
 * The only seam between MandiMitra and the model provider. Services depend on this interface so tests
 * can run a scripted model, and so no other file constructs an SDK client.
 */
export interface LlmClient {
  readonly enabled: boolean;
  create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>;
}

export type { BetaMessage, MessageCreateParamsNonStreaming };

/** Server-side refusal fallback (Claude Opus 5.5): a declined request is re-run on Anthropic's recommended model. */
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as const;

export function anthropicLlm(apiKey: string | undefined): LlmClient {
  // Zero-arg client also resolves ANTHROPIC_AUTH_TOKEN / `ant auth login` profiles.
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  return {
    enabled: true,
    create: (params) => client.beta.messages.create(params),
  };
}

export const disabledLlm: LlmClient = {
  enabled: false,
  create: () => Promise.reject(new Error('AI is not configured')),
};
