# OpenAI model routing

Storm Signal requests capabilities; business routes never select model IDs. The production entry point is `lib/openai/model-router.ts`.

## Current flows

- Weather conversation uses the Responses API with the Storm Signal MCP, conversation continuity, prompt-cache affinity, response validation and availability fallbacks.
- Voice input requests the `transcription` capability through the same catalog and telemetry contract.
- `WebChat` is a separate legacy prototype and is not part of the Landing Light production runtime.

## Policy

The deterministic v1 policy considers capability, risk, approximate context size, requested quality, MCP compatibility, enabled models and the request cost ceiling. It starts with the least expensive adequate tier:

- `nano` → `gpt-4.1-mini`: classification, extraction, short summaries and low-risk/high-volume work.
- `mini` → `gpt-4.1`: normal weather conversation, MCP lookup and validation.
- `frontier` → `gpt-5.1` with `reasoning.effort: none`: explicit comparisons, field plans, shareable briefs and deep reasoning.
- `transcription`: audio-to-text only.

GPT-5.6 is prohibited at the catalog boundary, including stale environment overrides. Deterministic quality validation is observable but never triggers a more expensive model automatically. Retryable availability, rate-limit and server failures may use a compatible fallback; non-retryable errors stop immediately. Requests that require current evidence set MCP tool choice to `required` on their first attempt.

Large contexts do not automatically justify GPT-5.1. Above its safe context threshold, routing prefers GPT-4.1's larger context window. The policy optimizes the task shape rather than equating more tokens with more reasoning.

## Calling the router

```ts
const route = selectModelRoute({
  capability: "comparison",
  input: userRequest,
  contextCharacters,
  risk: "medium",
  requiresMcp: true,
});

const result = await executeRoutedResponse(openai, route, {
  instructions,
  input: userRequest,
  tools,
  promptCacheKey: `storm-signal:${workspaceId}:chat-v1`,
});
```

Callers may request `classification`, `extraction`, `summary`, `generation`, `weather_chat`, `comparison`, `field_plan`, `field_brief`, `deep_reasoning`, `validation`, or `transcription`. They must not pass a model ID.

## Configuration

`OPENAI_MODELS_ENABLED` accepts aliases or model IDs. Model IDs, prices and the per-request ceiling are defined through the variables documented in `.env.example`. Changing or disabling a model requires configuration only; the policy and business routes do not change.

Default prices match the official standard API rates used when this policy was frozen and remain configurable. Voice transcription is reconciled from the provider-returned audio duration at `$0.003/minute`, not from a fixed amount per dictation.

## Budget and telemetry

Existing workspace entitlements enforce request rate, daily usage, concurrency and period cost. The router adds a per-request ceiling before reservation. Every model attempt records capability, alias, actual returned model, selection reason, latency, tokens, cache reads/writes, estimated cost, retry number, status and error code in `model_operation_logs`. Aggregate values remain on `execution_runs`.

## Prompt caching

The chat uses a stable workspace/product cache key. Reusable instructions remain at the beginning and request-specific time and market context follow them. Cache reads and writes are measured. Explicit breakpoints are intentionally deferred until production traces show that they improve net cost.

## Regression guards

- Streaming validation evaluates the accumulated provider deltas when the terminal SDK response does not repeat `output_text`.
- A quality rejection is recorded but cannot cause automatic escalation.
- GPT-5.6 IDs are disabled even if a stale deployment variable references one.
- Transcription reservations are reconciled against authoritative duration or token usage returned by OpenAI.

## Extension points

`selectModelRoute` is a pure policy boundary. A future scoring policy, evaluator, per-plan policy or admin-configured catalog can replace it without changing callers. Add a capability and its policy tests before adding a new OpenAI operation.
