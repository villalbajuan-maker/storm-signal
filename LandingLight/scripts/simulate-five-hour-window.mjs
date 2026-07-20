import { estimateAttemptReservationMicrousd, estimateCostCents, selectModelRoute } from "../lib/openai/model-router.ts";

export const WARNING_PERCENT = 90;
export const candidateBudgets = [27, 35, 40];

const step = (name, capability, inputTokens, outputTokens, cachedInputTokens, risk = "medium") => ({
  name, capability, inputTokens, outputTokens, cachedInputTokens, risk,
});

const common = {
  evidence: step("Check recent evidence", "weather_chat", 8_000, 600, 0),
  compare: step("Compare areas", "comparison", 14_000, 900, 8_000),
  clarify: step("Clarify one area", "weather_chat", 16_000, 700, 14_000),
  plan: step("Build field plan", "field_plan", 20_000, 1_300, 14_000, "high"),
  brief: step("Prepare field brief", "field_brief", 25_000, 1_800, 20_000, "high"),
  repeat: step("Repeat another check", "weather_chat", 18_000, 800, 16_000),
};

export const scenarios = [
  { name: "normal", steps: [common.evidence, common.compare, common.plan] },
  { name: "extended", steps: [common.evidence, common.compare, common.clarify, common.plan, common.brief] },
  { name: "excessive", steps: [common.evidence, common.compare, common.clarify, common.plan, common.brief, common.repeat, common.repeat, common.repeat, common.repeat, common.repeat, common.repeat, common.repeat, common.repeat] },
];

function routeFor(item) {
  return selectModelRoute({
    capability: item.capability,
    input: item.name,
    contextCharacters: item.inputTokens * 4,
    risk: item.risk,
    requiresMcp: !["summary", "generation"].includes(item.capability),
  });
}

export function simulate(scenario, budgetCents, enforcement) {
  let usedCents = 0;
  let warningReached = false;
  const events = [];

  for (const item of scenario.steps) {
    const route = routeFor(item);
    const actualCents = estimateCostCents(route.primary, item.inputTokens, item.outputTokens, item.cachedInputTokens);
    const remainingCents = budgetCents - usedCents;
    const attemptReservationCents = Math.ceil(estimateAttemptReservationMicrousd(route, route.primary) / 10_000);
    const requiredCents = enforcement === "current_router_reservation" ? attemptReservationCents : actualCents;
    if (requiredCents > remainingCents) {
      events.push({
        step: item.name,
        model: route.primary.alias,
        result: "blocked_before_provider",
        usedCents,
        remainingCents,
        reservationCents: attemptReservationCents,
        requiredCents,
      });
      break;
    }
    usedCents += actualCents;
    const usagePercentage = Math.round((usedCents / budgetCents) * 1000) / 10;
    warningReached ||= usagePercentage >= WARNING_PERCENT;
    events.push({
      step: item.name,
      model: route.primary.alias,
      result: "completed",
      actualCents,
      reservationCents: attemptReservationCents,
      usedCents,
      usagePercentage,
      status: usagePercentage >= 100 ? "exhausted" : usagePercentage >= WARNING_PERCENT ? "warning" : "available",
    });
  }

  return {
    scenario: scenario.name,
    enforcement,
    budgetCents,
    completedSteps: events.filter((event) => event.result === "completed").length,
    requestedSteps: scenario.steps.length,
    finalUsedCents: usedCents,
    finalUsagePercentage: Math.round((usedCents / budgetCents) * 1000) / 10,
    warningReached,
    blockedAt: events.find((event) => event.result === "blocked_before_provider")?.step || null,
    events,
  };
}

export function runSimulation() {
  const results = candidateBudgets.flatMap((budget) => scenarios.flatMap((scenario) => [
    simulate(scenario, budget, "measured_scenario_cost"),
    simulate(scenario, budget, "current_router_reservation"),
  ]));
  return {
    kind: "deterministic_no_provider_calls",
    assumptions: {
      warningPercentage: WARNING_PERCENT,
      candidateBudgetsCents: candidateBudgets,
      promptCaching: "Prior stable context is modeled as cached input after the first turn.",
      reservation: "Reports both probable measured scenario cost and the current router's cumulative planned fallback reservation.",
    },
    results,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(runSimulation(), null, 2));
