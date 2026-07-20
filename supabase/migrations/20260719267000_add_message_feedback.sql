begin;

create table public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  reasons text[] not null default '{}',
  details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, workspace_id) references public.conversations(id, workspace_id) on delete cascade,
  unique (message_id, user_id),
  constraint message_feedback_details_length check (details is null or length(details) <= 1200)
);

create index message_feedback_workspace_created_idx on public.message_feedback (workspace_id, created_at desc);
create trigger message_feedback_set_updated_at before update on public.message_feedback for each row execute function public.set_updated_at();
alter table public.message_feedback enable row level security;
create policy message_feedback_select_own on public.message_feedback for select to authenticated
  using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
revoke all on public.message_feedback from anon, authenticated;

commit;
