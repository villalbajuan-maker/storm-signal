# Storm Signal Release and Rollback Runbook V1

Status: active operating policy
Applies to: `LandingLight`, model routing, usage metering, Supabase schema and the authenticated workspace
Production alias: `https://signal.vectoros.co`
Known-good Vercel deployment at baseline: `dpl_FGryeJFWHnNYSf6RyCrhBh8dYLAP`

## Purpose

Storm Signal must be able to introduce product changes without losing the last known-good state. A release is complete only when it can be identified, validated, observed and reversed by layer.

The operating loop is:

> Baseline -> small change -> automated validation -> preview QA -> explicit go/no-go -> production smoke -> observe or roll back.

Passing locally is necessary but not sufficient. A production deployment without a verified rollback target is not a completed release.

## Baseline boundary

The recoverable product baseline includes:

- the `LandingLight` application and locked Node dependencies;
- the conversational, authorization, usage and deterministic-execution contracts;
- all Supabase migrations required by the authenticated workspace;
- database smoke and policy tests;
- CI validation for the application, Python/Deno services and migration replay;
- the environment-variable names and safe defaults in `.env.example`.

It never includes `.env.local`, provider secrets, Vercel local linkage, `node_modules`, compiled output or local runtime state.

## Required release gates

### 1. Scope gate

Each delivery must state the behavior being changed, the layers affected and the rollback mechanism. Unrelated edits are excluded from the release.

### 2. Local validation gate

For `LandingLight`:

```bash
cd LandingLight
npm ci
npm test
```

For backend contracts:

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
deno check supabase/functions/storm_signal_ingestor/index.ts
deno check supabase/functions/storm_signal_mcp/index.ts
deno check --config supabase/functions/storm_signal_nhc_ingestor/deno.json supabase/functions/storm_signal_nhc_ingestor/index.ts
```

Migration changes must also replay from zero in an ephemeral local Supabase instance and pass database lint. The GitHub validation workflow is the canonical reproducible execution of these checks.

### 3. Preview gate

Application changes are deployed to a Vercel preview before production. QA must cover, in proportion to the change:

- landing and `/start` rendering;
- new-user email verification and returning-user login;
- authenticated `/workspace` access and sign-out;
- conversation creation, persistence, rename and delete;
- a representative MCP-backed question;
- composer behavior and mobile viewport;
- usage status and exhaustion surfaces when metering changes.

Preview QA uses test identities and must not alter production policy configuration unless the release explicitly targets it.

### 4. Go/no-go gate

Promote only when:

- required CI checks are green;
- the preview acceptance path passes;
- a known-good production deployment is recorded;
- migrations are backward-compatible with the currently deployed application;
- new behavior can be disabled independently when its risk warrants a flag or shadow mode.

### 5. Production smoke gate

Immediately after promotion, verify:

- `/` returns successfully;
- unauthenticated `/workspace` redirects to authorization;
- an authorized account can enter the workspace;
- one bounded conversation completes without exposing internal errors;
- usage is reserved and reconciled exactly once when applicable;
- no material increase appears in provider errors, latency or cost telemetry.

## Rollback by layer

Rollback uses the smallest affected layer. Do not revert healthy layers simply because another layer failed.

### Frontend or API route

Promote or redeploy the recorded known-good Vercel deployment. Re-run the production smoke gate after the alias points back to it.

### Feature or execution policy

Disable the feature flag, return the policy to shadow mode, or restore the previous centralized router configuration. Prefer this immediate containment before a code redeploy when available.

### Environment configuration

Restore the prior value from the release inventory and redeploy. Secret values are maintained in the provider, never copied into the repository or this runbook.

### Model routing

Restore the previous model catalog/policy as one versioned unit. Business components must never be edited individually to change model identifiers. A routing rollback must preserve telemetry and the hard prohibition against unavailable or disallowed tiers.

### Database

Production migrations are forward-only by default. Use:

> expand -> migrate/backfill -> validate -> switch reads/writes -> observe -> contract later.

Never make a schema change depend on simultaneous application deployment. If a migration causes trouble, first disable the consuming feature or restore the previous application path, then ship a corrective forward migration. Restore from backup only for confirmed data loss or corruption and only after identifying the recovery point.

## Failure decision

Roll back immediately when authentication is broadly unavailable, workspace data crosses tenant boundaries, usage is charged more than once, secrets or internal architecture are exposed, the core MCP path is unavailable, or observed spend is materially uncontrolled.

For lower-severity failures, contain with a flag, collect evidence and correct forward only when the healthy product path remains available.

## Deterministic execution rollout

The deterministic conversational execution contract must be introduced incrementally:

1. instrument the existing path without changing output;
2. classify eligible intents in shadow mode;
3. compare deterministic and current-path results;
4. enable one bounded fast path behind a server-side flag;
5. observe correctness, latency and cost;
6. expand only after acceptance thresholds pass.

The current model-driven path remains the rollback path until deterministic fast paths have passed production acceptance independently.

## Release record

Every production release records:

- Git commit and optional release tag;
- Vercel deployment identifier;
- migrations introduced;
- configuration or flag changes;
- tests and preview checks completed;
- known-good rollback deployment;
- owner, timestamp and final outcome.

This record may live in a release note, pull request or deployment log, but must be recoverable without relying on chat history.
