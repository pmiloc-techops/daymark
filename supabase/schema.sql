-- Run once in the Supabase SQL Editor for a new project.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (lower(email) like '%@pmiloc.org'),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default '#4F46E5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.work_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  work_date date not null,
  hour_slot smallint not null check (hour_slot between 0 and 23),
  allocated_hours numeric(4,3) not null check (allocated_hours > 0 and allocated_hours <= 1),
  created_at timestamptz not null default now()
);

create index work_entries_user_date_idx on public.work_entries (user_id, work_date);
create index projects_user_active_idx on public.projects (user_id, archived_at);

create or replace function public.check_work_entry_allocation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare total_hours numeric;
begin
  if not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.user_id = new.user_id and p.archived_at is null
  ) then
    raise exception 'Project must be active and owned by the entry user';
  end if;

  select coalesce(sum(e.allocated_hours), 0) into total_hours
  from public.work_entries e
  where e.user_id = new.user_id and e.work_date = new.work_date
    and e.hour_slot = new.hour_slot and e.id <> new.id;

  if total_hours + new.allocated_hours > 1 then
    raise exception 'Allocations for an hour slot cannot exceed one hour';
  end if;
  return new;
end;
$$;

create trigger work_entry_allocation_guard
before insert or update on public.work_entries
for each row execute function public.check_work_entry_allocation();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.work_entries enable row level security;

create policy "Users can read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users can update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and lower(email) like '%@pmiloc.org');

create policy "Users can read own projects" on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can create own projects" on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update own projects" on public.projects
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can read own work entries" on public.work_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can create own work entries" on public.work_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update own work entries" on public.work_entries
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete own work entries" on public.work_entries
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or lower(new.email) not like '%@pmiloc.org' then
    raise exception 'Only @pmiloc.org accounts are allowed';
  end if;

  insert into public.profiles (id, email) values (new.id, lower(new.email));
  insert into public.projects (user_id, name, color) values
    (new.id, 'osTicket', '#48A58C'),
    (new.id, 'Meetings', '#5574D9'),
    (new.id, 'New Website', '#B47AD5');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
