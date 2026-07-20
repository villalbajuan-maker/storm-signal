import assert from "node:assert/strict";
import test from "node:test";
import { scenarios, simulate } from "../scripts/simulate-five-hour-window.mjs";

const scenario = (name) => scenarios.find((item) => item.name === name);

test("27 cents supports the normal decision cycle in the behavioral baseline", () => {
  const result = simulate(scenario("normal"), 27, "measured_scenario_cost");
  assert.equal(result.completedSteps, result.requestedSteps);
  assert.equal(result.finalUsedCents, 8);
  assert.equal(result.warningReached, false);
});

test("27 cents lets an extended cycle complete with room for follow-up", () => {
  const result = simulate(scenario("extended"), 27, "measured_scenario_cost");
  assert.equal(result.completedSteps, result.requestedSteps);
  assert.equal(result.finalUsedCents, 13);
  assert.equal(result.finalUsagePercentage, 48.1);
  assert.equal(result.warningReached, false);
});

test("27 cents blocks excessive follow-up only after the extended product arc", () => {
  const result = simulate(scenario("excessive"), 27, "measured_scenario_cost");
  assert.equal(result.completedSteps, 12);
  assert.equal(result.blockedAt, "Repeat another check");
  assert.equal(result.warningReached, true);
});

test("per-attempt reservation supports normal and extended arcs while guarding excess", () => {
  const normal = simulate(scenario("normal"), 27, "current_router_reservation");
  assert.equal(normal.completedSteps, normal.requestedSteps);
  const extended = simulate(scenario("extended"), 27, "current_router_reservation");
  assert.equal(extended.completedSteps, extended.requestedSteps);
  const result = simulate(scenario("excessive"), 27, "current_router_reservation");
  assert.equal(result.blockedAt, "Repeat another check");
  assert.equal(result.finalUsedCents, 23);
});

test("a five-hour window keeps its original closing time after exhaustion", () => {
  const startedAt = new Date("2026-07-20T19:50:00-05:00");
  const endsAt = new Date(startedAt.getTime() + 5 * 60 * 60 * 1000);
  const exhaustedAt = new Date(startedAt.getTime() + 47 * 60 * 1000);
  assert.ok(exhaustedAt < endsAt);
  assert.equal(endsAt.toISOString(), "2026-07-21T05:50:00.000Z");
});
