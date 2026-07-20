import OpenAI from "openai";
import type { Response as OpenAIResponse, ResponseCreateParamsNonStreaming, ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses";

export type ModelAlias = "nano" | "mini" | "frontier" | "transcription";
export type ModelCapability = "classification" | "extraction" | "summary" | "generation" | "weather_chat" | "comparison" | "field_plan" | "field_brief" | "deep_reasoning" | "transcription" | "validation";
export type RoutingRisk = "low" | "medium" | "high";

export type ModelConfig = {
  alias: ModelAlias;
  id: string;
  enabled: boolean;
  inputCentsPerMillion: number;
  cachedInputCentsPerMillion: number;
  outputCentsPerMillion: number;
  contextWindow: number;
  maxOutputTokens: number;
  supportsResponses: boolean;
  supportsMcp: boolean;
  supportsPromptCaching: boolean;
  supportsReasoning: boolean;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  audioCentsPerMinute?: number;
};

export type RoutingRequest = {
  capability: ModelCapability;
  input: string;
  contextCharacters?: number;
  risk?: RoutingRisk;
  quality?: "economy" | "balanced" | "highest";
  requiresMcp?: boolean;
  maxCostCents?: number;
};

export type RoutePlan = {
  capability: ModelCapability;
  primary: ModelConfig;
  attempts: ModelConfig[];
  reason: string;
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  estimatedCostMicrousd: number;
  estimatedCostCents: number;
  reservationCostCents: number;
  maxCostCents: number;
  requiresMcp: boolean;
};

export type RoutedAttempt = {
  model: string;
  alias: ModelAlias;
  reason: string;
  status: "succeeded" | "quality_rejected" | "failed";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  estimatedCostMicrousd: number;
  estimatedCostCents: number;
  errorCode: string | null;
  audioDurationSeconds?: number;
  usageWindowId?: string;
  usageReservationId?: string;
};

export type AttemptLease = {
  executionRunId?: string;
  usageWindowId?: string;
  usageReservationId?: string;
};

type AttemptStartContext = { attemptNumber: number; model: ModelConfig; route: RoutePlan; reservationMicrousd: number };
type AttemptFinishContext = { attemptNumber: number; model: ModelConfig; route: RoutePlan; attempt: RoutedAttempt; lease?: AttemptLease; willRetry: boolean };

type ResponseRequest = {
  instructions: string;
  input: string;
  previousResponseId?: string;
  tools?: Array<{ type: "mcp"; server_label: string; server_url: string; require_approval: "never" }>;
  promptCacheKey?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => Promise<void> | void;
  onMcpActivity?: (activity: { itemId: string; name?: string; status: "discovering" | "running" | "completed" | "failed" }) => Promise<void> | void;
  onAttemptStart?: (context: AttemptStartContext) => Promise<AttemptLease | void>;
  onAttemptFinish?: (context: AttemptFinishContext) => Promise<void>;
};

export type RoutedResponse = {
  response: OpenAIResponse;
  model: ModelConfig;
  attempts: RoutedAttempt[];
  route: RoutePlan;
};

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

function enabledModelIds() {
  const raw = process.env.OPENAI_MODELS_ENABLED?.trim();
  return raw ? new Set(raw.split(",").map((item) => item.trim()).filter(Boolean)) : null;
}

function prohibitedModel(id: string) {
  return /^gpt-5\.6(?:-|$)/i.test(id);
}

export function getModelCatalog(): Record<ModelAlias, ModelConfig> {
  const allow = enabledModelIds();
  const build = (alias: ModelAlias, id: string, input: number, cached: number, output: number, contextWindow: number, supportsResponses = true): ModelConfig => ({
    alias, id, enabled: !prohibitedModel(id) && (!allow || allow.has(alias) || allow.has(id)),
    inputCentsPerMillion: numberFromEnv(`OPENAI_${alias.toUpperCase()}_INPUT_CENTS_PER_MILLION`, input),
    cachedInputCentsPerMillion: numberFromEnv(`OPENAI_${alias.toUpperCase()}_CACHED_INPUT_CENTS_PER_MILLION`, cached),
    outputCentsPerMillion: numberFromEnv(`OPENAI_${alias.toUpperCase()}_OUTPUT_CENTS_PER_MILLION`, output),
    contextWindow, maxOutputTokens: 128_000, supportsResponses,
    supportsMcp: alias !== "transcription", supportsPromptCaching: alias !== "transcription",
    supportsReasoning: /^gpt-5|^o\d/.test(id),
    ...(id === "gpt-5.1" ? { reasoningEffort: "none" as const } : {}),
    ...(alias === "transcription" ? { audioCentsPerMinute: numberFromEnv("OPENAI_TRANSCRIPTION_AUDIO_CENTS_PER_MINUTE", 0.3) } : {}),
  });
  return {
    nano: build("nano", process.env.OPENAI_MODEL_NANO || "gpt-4.1-mini", 40, 10, 160, 1_047_576),
    mini: build("mini", process.env.OPENAI_MODEL_MINI || "gpt-4.1", 200, 50, 800, 1_047_576),
    frontier: build("frontier", process.env.OPENAI_MODEL_FRONTIER || "gpt-5.1", 125, 12.5, 1000, 400_000),
    transcription: build("transcription", process.env.OPENAI_MODEL_TRANSCRIPTION || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe", 125, 0, 500, 0, false),
  };
}

export function inferChatCapability(input: string): ModelCapability {
  const text = input.toLowerCase();
  if (/\b(field brief|field plan|brief|report|pdf|shareable|action plan|deployment plan)\b/.test(text)) return /brief|report|pdf|shareable/.test(text) ? "field_brief" : "field_plan";
  if (/\b(compare|comparison|rank|ranking|prioriti[sz]e|best (area|market)|which .* first)\b/.test(text)) return "comparison";
  if (/\b(explain|summari[sz]e|recap|what does .* mean)\b/.test(text)) return "summary";
  if (/\b(storm|weather|hail|wind|tornado|hurricane|warning|report|market|county|zip|damage|roof|restoration)\b/.test(text)) return "weather_chat";
  return "generation";
}

export function chatRequiresMcp(input: string, capability: ModelCapability, hasPriorContext: boolean) {
  if (["generation", "summary"].includes(capability)) return false;
  if (!hasPriorContext) return true;
  const text = input.toLowerCase();
  const requestsFreshEvidence = /\b(find|search|look up|latest|recent|new evidence|update|refresh|today|yesterday|right now|last \d+)\b/.test(text);
  if (requestsFreshEvidence) return true;
  const transformsEstablishedContext = /\b(those|these|them|that evidence|this evidence|from that|from those|top two|top three|turn this|based on that|based on this|highest-ranked|the top)\b/.test(text);
  if (transformsEstablishedContext) return false;
  if (/\bcheck\b/.test(text)) return true;
  return capability === "weather_chat";
}

export function estimateTokens(characters: number) { return Math.max(1, Math.ceil(characters / 4)); }

export function estimateCostMicrousd(model: ModelConfig, inputTokens: number, outputTokens: number, cachedInputTokens = 0, cacheWriteTokens = 0) {
  const uncached = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens);
  const weightedCentsPerMillion = uncached * model.inputCentsPerMillion + cachedInputTokens * model.cachedInputCentsPerMillion + cacheWriteTokens * model.inputCentsPerMillion * 1.25 + outputTokens * model.outputCentsPerMillion;
  return Math.max(0, Math.ceil(weightedCentsPerMillion / 100));
}

export function estimateCostCents(model: ModelConfig, inputTokens: number, outputTokens: number, cachedInputTokens = 0, cacheWriteTokens = 0) {
  return Math.ceil(estimateCostMicrousd(model, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens) / 10_000);
}

function preferredAlias(request: RoutingRequest, inputTokens: number): ModelAlias {
  if (request.capability === "transcription") return "transcription";
  if (inputTokens > 320_000) return "mini";
  if (request.quality === "highest" || ["comparison", "field_plan", "field_brief", "deep_reasoning"].includes(request.capability)) return "frontier";
  if (["weather_chat", "validation"].includes(request.capability) || request.risk === "medium" || inputTokens > 24_000) return "mini";
  return "nano";
}

export function selectModelRoute(request: RoutingRequest): RoutePlan {
  const catalog = getModelCatalog();
  const inputTokens = estimateTokens(request.input.length + (request.contextCharacters || 0));
  const preferred = preferredAlias(request, inputTokens);
  const ladders: Record<ModelAlias, ModelAlias[]> = {
    nano: ["nano", "mini", "frontier"], mini: ["mini", "frontier", "nano"], frontier: ["frontier", "mini", "nano"], transcription: ["transcription"],
  };
  const maxCostCents = request.maxCostCents ?? numberFromEnv("OPENAI_MAX_REQUEST_COST_CENTS", 25);
  let eligible = ladders[preferred].map((alias) => catalog[alias]).filter((model) => model.enabled && (!request.requiresMcp || model.supportsMcp) && (request.capability === "transcription" || inputTokens <= model.contextWindow));
  if (request.capability === "transcription" && process.env.OPENAI_MODEL_TRANSCRIPTION_FALLBACK?.trim()) eligible = [...eligible, { ...catalog.transcription, id: process.env.OPENAI_MODEL_TRANSCRIPTION_FALLBACK.trim() }];
  if (!eligible.length) throw new Error(`No enabled model can satisfy ${request.capability}.`);
  const expectedOutput = request.capability === "deep_reasoning"
    ? 3500
    : ["field_brief", "field_plan"].includes(request.capability)
      ? 900
      : request.capability === "comparison"
        ? 1400
        : 1000;
  const attempts: ModelConfig[] = [];
  let reservationCostCents = 0;
  if (estimateCostCents(eligible[0], inputTokens, expectedOutput) > maxCostCents) {
    throw new Error(`The estimated ${request.capability} request exceeds its model budget.`);
  }
  for (const model of eligible) {
    const estimate = estimateCostCents(model, inputTokens, expectedOutput);
    if (reservationCostCents + estimate <= maxCostCents) { attempts.push(model); reservationCostCents += estimate; }
  }
  if (!attempts.length) throw new Error(`The estimated ${request.capability} request exceeds its model budget.`);
  const primary = attempts[0];
  const signals = [`capability=${request.capability}`, `risk=${request.risk || "low"}`, `context≈${inputTokens} tokens`, `quality=${request.quality || "balanced"}`];
  if (primary.alias !== preferred) signals.push(`budget constrained from ${preferred}`);
  return { capability: request.capability, primary, attempts, reason: signals.join("; "), estimatedInputTokens: inputTokens, expectedOutputTokens: expectedOutput, estimatedCostMicrousd: estimateCostMicrousd(primary, inputTokens, expectedOutput), estimatedCostCents: estimateCostCents(primary, inputTokens, expectedOutput), reservationCostCents, maxCostCents, requiresMcp: Boolean(request.requiresMcp) };
}

export function estimateAttemptReservationMicrousd(route: RoutePlan, model: ModelConfig) {
  if (route.capability === "transcription") return Math.max(1, numberFromEnv("OPENAI_TRANSCRIPTION_RESERVATION_MICROUSD", 6_000));
  return Math.max(1, estimateCostMicrousd(model, route.estimatedInputTokens, route.expectedOutputTokens));
}

export function estimateTranscriptionCostMicrousd(model: ModelConfig, seconds: number) {
  return Math.max(0, Math.ceil(Math.max(0, seconds) * (model.audioCentsPerMinute || 0) * 10_000 / 60));
}

function reasoningParams(model: ModelConfig) {
  return model.supportsReasoning ? { reasoning: { effort: model.reasoningEffort || "low" as const } } : {};
}

function responseQualityIsAcceptable(capability: ModelCapability, text: string, toolCount: number, requiresMcp: boolean) {
  const minimum = capability === "field_brief" ? 320 : capability === "field_plan" ? 240 : 60;
  if (text.trim().length < minimum) return false;
  if (requiresMcp && toolCount === 0 && !/coverage|cannot|can't|outside|not available/i.test(text)) return false;
  return true;
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "status" in error) return `openai_${Number(error.status) || "error"}`;
  return error instanceof Error ? error.name.slice(0, 80) : "openai_error";
}

function retryable(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  return status === 404 || status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function executeRoutedResponse(client: OpenAI, route: RoutePlan, request: ResponseRequest): Promise<RoutedResponse> {
  const attempts: RoutedAttempt[] = [];
  let lastError: unknown;
  for (let index = 0; index < route.attempts.length; index++) {
    const model = route.attempts[index];
    const attemptNumber = index + 1;
    let lease: AttemptLease | undefined;
    try {
      lease = await request.onAttemptStart?.({ attemptNumber, model, route, reservationMicrousd: estimateAttemptReservationMicrousd(route, model) }) || undefined;
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error("Model attempt could not be reserved."), { routingAttempts: attempts });
    }
    const started = Date.now();
    try {
      const params: ResponseCreateParamsNonStreaming = {
        model: model.id,
        instructions: request.instructions,
        input: request.input,
        previous_response_id: request.previousResponseId,
        tools: request.tools,
        ...(request.tools?.length ? { tool_choice: route.requiresMcp ? "required" as const : "auto" as const } : {}),
        max_output_tokens: route.expectedOutputTokens,
        ...reasoningParams(model),
        ...(model.supportsPromptCaching && request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
      };
      const response = await client.responses.create(params, { signal: request.signal });
      const usage = response.usage;
      const details = usage?.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number } | undefined;
      const tools = response.output.filter((item) => item.type === "mcp_call");
      const costMicrousd = estimateCostMicrousd(model, usage?.input_tokens || 0, usage?.output_tokens || 0, details?.cached_tokens || 0, details?.cache_write_tokens || 0);
      const accepted = responseQualityIsAcceptable(route.capability, response.output_text || "", tools.length, route.requiresMcp);
      const attempt: RoutedAttempt = { model: response.model || model.id, alias: model.alias, reason: index ? `fallback after ${attempts[index - 1]?.status}` : route.reason, status: accepted ? "succeeded" : "quality_rejected", latencyMs: Date.now() - started, inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0, cachedInputTokens: details?.cached_tokens || 0, cacheWriteTokens: details?.cache_write_tokens || 0, estimatedCostMicrousd: costMicrousd, estimatedCostCents: Math.ceil(costMicrousd / 10_000), errorCode: null, usageWindowId: lease?.usageWindowId, usageReservationId: lease?.usageReservationId };
      const willRetry = false;
      try { await request.onAttemptFinish?.({ attemptNumber, model, route, attempt, lease, willRetry }); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Model attempt could not be reconciled."), { routingAttempts: [...attempts, attempt] }); }
      attempts.push(attempt);
      return { response, model, attempts, route };
    } catch (error) {
      if (typeof error === "object" && error && "routingAttempts" in error) throw error;
      lastError = error;
      const attempt: RoutedAttempt = { model: model.id, alias: model.alias, reason: index ? "fallback attempt" : route.reason, status: "failed", latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, estimatedCostMicrousd: 0, estimatedCostCents: 0, errorCode: errorCode(error), usageWindowId: lease?.usageWindowId, usageReservationId: lease?.usageReservationId };
      const willRetry = retryable(error) && index < route.attempts.length - 1;
      try { await request.onAttemptFinish?.({ attemptNumber, model, route, attempt, lease, willRetry }); } catch (reconcileError) { throw Object.assign(reconcileError instanceof Error ? reconcileError : new Error("Failed attempt could not be reconciled."), { routingAttempts: [...attempts, attempt] }); }
      attempts.push(attempt);
      if (!retryable(error) || index === route.attempts.length - 1) throw Object.assign(error instanceof Error ? error : new Error("OpenAI request failed."), { routingAttempts: attempts });
    }
  }
  throw Object.assign(lastError instanceof Error ? lastError : new Error("No model completed the request."), { routingAttempts: attempts });
}

function streamingFailure(message: string, code?: string | null) {
  const status = code === "rate_limit_exceeded" ? 429 : code === "server_error" ? 500 : undefined;
  return Object.assign(new Error(message), status ? { status } : {});
}

/**
 * Executes the same routed response policy as executeRoutedResponse, while
 * exposing provider text deltas and MCP lifecycle events as they happen.
 * A provider fallback is only safe before any answer text has been exposed.
 */
export async function executeRoutedStreamingResponse(client: OpenAI, route: RoutePlan, request: ResponseRequest): Promise<RoutedResponse> {
  const attempts: RoutedAttempt[] = [];
  let lastError: unknown;
  for (let index = 0; index < route.attempts.length; index++) {
    const model = route.attempts[index];
    const attemptNumber = index + 1;
    let lease: AttemptLease | undefined;
    let exposedText = false;
    let streamedText = "";
    let terminalResponse: OpenAIResponse | undefined;
    const mcpNames = new Map<string, string>();
    try {
      lease = await request.onAttemptStart?.({ attemptNumber, model, route, reservationMicrousd: estimateAttemptReservationMicrousd(route, model) }) || undefined;
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error("Model attempt could not be reserved."), { routingAttempts: attempts });
    }
    const started = Date.now();
    try {
      const params: ResponseCreateParamsStreaming = {
        model: model.id,
        instructions: request.instructions,
        input: request.input,
        previous_response_id: request.previousResponseId,
        tools: request.tools,
        ...(request.tools?.length ? { tool_choice: route.requiresMcp ? "required" as const : "auto" as const } : {}),
        max_output_tokens: route.expectedOutputTokens,
        stream: true,
        ...reasoningParams(model),
        ...(model.supportsPromptCaching && request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
      };
      const stream = await client.responses.create(params, { signal: request.signal });
      for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
        if (event.type === "response.output_text.delta" && event.delta) {
          exposedText = true;
          streamedText += event.delta;
          await request.onTextDelta?.(event.delta);
        } else if (event.type === "response.mcp_list_tools.in_progress") {
          await request.onMcpActivity?.({ itemId: event.item_id, status: "discovering" });
        } else if (event.type === "response.output_item.added" && event.item.type === "mcp_call") {
          mcpNames.set(event.item.id, event.item.name);
          await request.onMcpActivity?.({ itemId: event.item.id, name: event.item.name, status: "running" });
        } else if (event.type === "response.mcp_call.in_progress") {
          await request.onMcpActivity?.({ itemId: event.item_id, name: mcpNames.get(event.item_id), status: "running" });
        } else if (event.type === "response.mcp_call.completed") {
          await request.onMcpActivity?.({ itemId: event.item_id, name: mcpNames.get(event.item_id), status: "completed" });
        } else if (event.type === "response.mcp_call.failed") {
          await request.onMcpActivity?.({ itemId: event.item_id, name: mcpNames.get(event.item_id), status: "failed" });
        } else if (event.type === "response.completed" || event.type === "response.incomplete") {
          terminalResponse = event.response;
        } else if (event.type === "response.failed") {
          terminalResponse = event.response;
          throw streamingFailure(event.response.error?.message || "OpenAI could not complete the streamed response.", event.response.error?.code);
        } else if (event.type === "error") {
          throw streamingFailure(event.message, event.code);
        }
      }
      if (!terminalResponse) throw new Error("The OpenAI stream ended without a terminal response.");
      const usage = terminalResponse.usage;
      const details = usage?.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number } | undefined;
      const tools = terminalResponse.output.filter((item) => item.type === "mcp_call");
      const costMicrousd = estimateCostMicrousd(model, usage?.input_tokens || 0, usage?.output_tokens || 0, details?.cached_tokens || 0, details?.cache_write_tokens || 0);
      const accepted = responseQualityIsAcceptable(route.capability, terminalResponse.output_text || streamedText, tools.length, route.requiresMcp);
      const attempt: RoutedAttempt = { model: terminalResponse.model || model.id, alias: model.alias, reason: index ? `fallback after ${attempts[index - 1]?.status}` : route.reason, status: accepted ? "succeeded" : "quality_rejected", latencyMs: Date.now() - started, inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0, cachedInputTokens: details?.cached_tokens || 0, cacheWriteTokens: details?.cache_write_tokens || 0, estimatedCostMicrousd: costMicrousd, estimatedCostCents: Math.ceil(costMicrousd / 10_000), errorCode: null, usageWindowId: lease?.usageWindowId, usageReservationId: lease?.usageReservationId };
      const willRetry = false;
      try { await request.onAttemptFinish?.({ attemptNumber, model, route, attempt, lease, willRetry }); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Model attempt could not be reconciled."), { routingAttempts: [...attempts, attempt] }); }
      attempts.push(attempt);
      return { response: terminalResponse, model, attempts, route };
    } catch (error) {
      if (typeof error === "object" && error && "routingAttempts" in error) throw error;
      lastError = error;
      const usage = terminalResponse?.usage;
      const details = usage?.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number } | undefined;
      const costMicrousd = estimateCostMicrousd(model, usage?.input_tokens || 0, usage?.output_tokens || 0, details?.cached_tokens || 0, details?.cache_write_tokens || 0);
      const attempt: RoutedAttempt = { model: terminalResponse?.model || model.id, alias: model.alias, reason: index ? "fallback attempt" : route.reason, status: "failed", latencyMs: Date.now() - started, inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0, cachedInputTokens: details?.cached_tokens || 0, cacheWriteTokens: details?.cache_write_tokens || 0, estimatedCostMicrousd: costMicrousd, estimatedCostCents: Math.ceil(costMicrousd / 10_000), errorCode: errorCode(error), usageWindowId: lease?.usageWindowId, usageReservationId: lease?.usageReservationId };
      const willRetry = !exposedText && retryable(error) && index < route.attempts.length - 1;
      try { await request.onAttemptFinish?.({ attemptNumber, model, route, attempt, lease, willRetry }); } catch (reconcileError) { throw Object.assign(reconcileError instanceof Error ? reconcileError : new Error("Failed attempt could not be reconciled."), { routingAttempts: [...attempts, attempt] }); }
      attempts.push(attempt);
      if (!willRetry) throw Object.assign(error instanceof Error ? error : new Error("OpenAI streaming request failed."), { routingAttempts: attempts });
    }
  }
  throw Object.assign(lastError instanceof Error ? lastError : new Error("No model completed the streamed request."), { routingAttempts: attempts });
}

export async function executeRoutedTranscription(client: OpenAI, audio: File, prompt: string, lifecycle?: Pick<ResponseRequest, "onAttemptStart" | "onAttemptFinish">) {
  const route = selectModelRoute({ capability: "transcription", input: prompt, risk: "low" });
  const attempts: RoutedAttempt[] = [];
  for (let index = 0; index < route.attempts.length; index++) {
    const model = route.attempts[index];
    const attemptNumber = index + 1;
    let lease: AttemptLease | undefined;
    try { lease = await lifecycle?.onAttemptStart?.({ attemptNumber, model, route, reservationMicrousd: estimateAttemptReservationMicrousd(route, model) }) || undefined; }
    catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Transcription attempt could not be reserved."), { routingAttempts: attempts }); }
    const started = Date.now();
    try {
      const transcription = await client.audio.transcriptions.create({ file: audio, model: model.id, prompt });
      const usage = transcription.usage;
      const durationSeconds = usage?.type === "duration" ? usage.seconds : 0;
      const inputTokens = usage?.type === "tokens" ? usage.input_tokens : 0;
      const outputTokens = usage?.type === "tokens" ? usage.output_tokens : 0;
      const costMicrousd = durationSeconds > 0
        ? estimateTranscriptionCostMicrousd(model, durationSeconds)
        : estimateCostMicrousd(model, inputTokens, outputTokens);
      const attempt: RoutedAttempt = { model: model.id, alias: model.alias, reason: index ? "transcription fallback" : route.reason, status: "succeeded", latencyMs: Date.now() - started, inputTokens, outputTokens, cachedInputTokens: 0, cacheWriteTokens: 0, estimatedCostMicrousd: costMicrousd, estimatedCostCents: Math.ceil(costMicrousd / 10_000), errorCode: null, audioDurationSeconds: durationSeconds, usageWindowId: lease?.usageWindowId, usageReservationId: lease?.usageReservationId };
      try { await lifecycle?.onAttemptFinish?.({ attemptNumber, model, route, attempt, lease, willRetry: false }); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Transcription attempt could not be reconciled."), { routingAttempts: [...attempts, attempt] }); }
      attempts.push(attempt);
      return { transcription, route, attempts };
    } catch (error) {
      if (typeof error === "object" && error && "routingAttempts" in error) throw error;
      const attempt: RoutedAttempt = { model: model.id, alias: model.alias, reason: index ? "transcription fallback" : route.reason, status: "failed", latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, estimatedCostMicrousd: 0, estimatedCostCents: 0, errorCode: errorCode(error), usageWindowId: lease?.usageWindowId, usageReservationId: lease?.usageReservationId };
      const willRetry = retryable(error) && index < route.attempts.length - 1;
      try { await lifecycle?.onAttemptFinish?.({ attemptNumber, model, route, attempt, lease, willRetry }); } catch (reconcileError) { throw Object.assign(reconcileError instanceof Error ? reconcileError : new Error("Failed transcription could not be reconciled."), { routingAttempts: [...attempts, attempt] }); }
      attempts.push(attempt);
      if (!retryable(error) || index === route.attempts.length - 1) throw Object.assign(error instanceof Error ? error : new Error("Transcription failed."), { routingAttempts: attempts });
    }
  }
  throw Object.assign(new Error("No transcription model completed the request."), { routingAttempts: attempts });
}
