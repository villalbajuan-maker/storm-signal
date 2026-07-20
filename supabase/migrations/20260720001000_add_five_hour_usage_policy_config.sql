begin;

alter table public.usage_policies
  add column if not exists usage_window_mode text not null default 'disabled'
    check (usage_window_mode in ('disabled', 'shadow', 'enforced')),
  add column if not exists usage_window_minutes integer not null default 300
    check (usage_window_minutes between 60 and 1440),
  add column if not exists usage_warning_percentage numeric(5,2) not null default 90
    check (usage_warning_percentage > 0 and usage_warning_percentage < 100),
  add column if not exists usage_window_budget_microusd bigint
    check (usage_window_budget_microusd is null or usage_window_budget_microusd > 0),
  add column if not exists max_period_cost_microusd bigint
    check (max_period_cost_microusd is null or max_period_cost_microusd > 0),
  add column if not exists max_operation_cost_microusd bigint
    check (max_operation_cost_microusd is null or max_operation_cost_microusd > 0),
  add column if not exists reservation_expiration_seconds integer not null default 600
    check (reservation_expiration_seconds between 60 and 3600),
  add column if not exists usage_pricing_version text not null default 'operational-estimate-v1'
    check (length(trim(usage_pricing_version)) between 1 and 80);

comment on column public.usage_policies.usage_window_mode is
  'disabled preserves legacy limits; shadow calculates without blocking; enforced makes the five-hour window authoritative.';
comment on column public.usage_policies.usage_window_minutes is
  'Fixed duration beginning with the first accepted paid operation. Later activity never moves the closing time.';
comment on column public.usage_policies.usage_warning_percentage is
  'Customer warning threshold for the active usage window.';
comment on column public.usage_policies.usage_window_budget_microusd is
  'Provider-cost allowance for one fixed window, stored in millionths of one US dollar.';
comment on column public.usage_policies.max_period_cost_microusd is
  'Silent aggregate economic backstop for the entitlement period.';
comment on column public.usage_policies.max_operation_cost_microusd is
  'Maximum reservable provider cost for one operation before incremental routed attempts.';
comment on column public.usage_policies.reservation_expiration_seconds is
  'Age after which an abandoned model-cost reservation can be released.';
comment on column public.usage_policies.usage_pricing_version is
  'Version label for the price assumptions used by metering and calibration.';

update public.usage_policies
set
  usage_window_mode = 'shadow',
  usage_window_minutes = 300,
  usage_warning_percentage = 90,
  usage_window_budget_microusd = 270000,
  max_period_cost_microusd = 9310000,
  max_operation_cost_microusd = 250000,
  reservation_expiration_seconds = 600,
  usage_pricing_version = 'operational-estimate-v1'
where plan = 'trial' and active;

update public.usage_policies
set
  usage_window_mode = 'disabled',
  usage_window_budget_microusd = null,
  max_period_cost_microusd = max_period_cost_cents::bigint * 10000,
  max_operation_cost_microusd = 250000,
  reservation_expiration_seconds = 600,
  usage_pricing_version = 'operational-estimate-v1'
where plan <> 'trial' and active;

commit;
