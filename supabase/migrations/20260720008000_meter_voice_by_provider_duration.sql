begin;

alter table public.model_operation_logs
  add column if not exists audio_duration_seconds numeric(12, 3) not null default 0
  check (audio_duration_seconds >= 0);

comment on column public.model_operation_logs.audio_duration_seconds is
  'Authoritative audio duration returned by the OpenAI transcription response; used for voice cost metering.';

commit;
