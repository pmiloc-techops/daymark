-- User created shared projects and project specific shared booking schedules.
alter table public.projects
  add column if not exists is_shared boolean not null default false,
  add column if not exists claimed_once_at timestamptz;

-- osTicket remains a built-in shared schedule; historical personal work is untouched.
update public.projects set is_shared = true where system_key = 'osticket';

create table if not exists public.shared_project_booked_slots (
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date date not null,
  hour_slot smallint not null check (hour_slot between 0 and 23),
  created_at timestamptz not null default now(),
  primary key (project_id, work_date, hour_slot)
);

create table if not exists public.shared_project_claims (
  project_id uuid not null,
  work_date date not null,
  hour_slot smallint not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_entry_id uuid not null unique references public.work_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (project_id, work_date, hour_slot),
  foreign key (project_id, work_date, hour_slot)
    references public.shared_project_booked_slots(project_id, work_date, hour_slot) on delete cascade
);

alter table public.shared_project_booked_slots enable row level security;
alter table public.shared_project_claims enable row level security;
drop policy if exists "Authenticated users can read shared project availability" on public.shared_project_booked_slots;
create policy "Authenticated users can read shared project availability"
  on public.shared_project_booked_slots for select to authenticated
  using ((select auth.uid()) is not null);
drop policy if exists "Users can read own shared project claims" on public.shared_project_claims;
create policy "Users can read own shared project claims"
  on public.shared_project_claims for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.shared_project_booked_slots from anon, authenticated;
grant select on public.shared_project_booked_slots to authenticated;
revoke all on public.shared_project_claims from anon, authenticated;
grant select on public.shared_project_claims to authenticated;

-- Move active osTicket reservations to the generalized project keyed tables.
insert into public.shared_project_booked_slots (project_id, work_date, hour_slot)
select p.id, b.work_date, b.hour_slot
from public.osticket_booked_slots b
join public.osticket_claims c using (work_date, hour_slot)
join public.projects p on p.user_id = c.user_id and p.system_key = 'osticket'
on conflict (project_id, work_date, hour_slot) do nothing;

insert into public.shared_project_claims (project_id, work_date, hour_slot, user_id, work_entry_id)
select p.id, c.work_date, c.hour_slot, c.user_id, c.work_entry_id
from public.osticket_claims c
join public.projects p on p.user_id = c.user_id and p.system_key = 'osticket'
on conflict (project_id, work_date, hour_slot) do nothing;

update public.projects p set claimed_once_at = coalesce(p.claimed_once_at, now())
where p.system_key = 'osticket'
  and exists (select 1 from public.shared_project_claims c where c.project_id = p.id);

-- A user's projects cannot be re-owned, or remove/privatize a project after its first claim.
create or replace function public.protect_system_projects()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null or old.claimed_once_at is not null then
      raise exception 'Protected or previously claimed projects cannot be deleted';
    end if;
    return old;
  end if;

  if old.user_id is distinct from new.user_id or old.system_key is distinct from new.system_key then
    raise exception 'Project ownership and system identity cannot be changed';
  end if;
  if old.system_key is not null and new.archived_at is not null then
    raise exception 'Meetings and osTicket projects cannot be archived';
  end if;
  if old.claimed_once_at is not null and (new.archived_at is not null or not new.is_shared) then
    raise exception 'A project used for a shared booking must stay active and shared';
  end if;
  if old.claimed_once_at is not null and new.claimed_once_at is distinct from old.claimed_once_at then
    raise exception 'Project claim history cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_system_projects_guard on public.projects;
create trigger protect_system_projects_guard
before update or delete on public.projects
for each row execute function public.protect_system_projects();

create or replace function public.enforce_project_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare personal_count integer; shared_count integer;
begin
  if new.system_key is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':project-limits', 19));

  if new.is_shared then
    select count(*) into shared_count from public.projects p
    where p.user_id = new.user_id and p.system_key is null and p.is_shared and p.archived_at is null
      and (tg_op <> 'UPDATE' or p.id <> new.id);
    if shared_count >= 3 then raise exception 'You can share up to 3 of your projects'; end if;
  else
    select count(*) into personal_count from public.projects p
    where p.user_id = new.user_id and p.system_key is null and not p.is_shared and p.archived_at is null
      and (tg_op <> 'UPDATE' or p.id <> new.id);
    if personal_count >= 3 then raise exception 'You can create up to 3 personal projects'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_create_limit_guard on public.projects;
create trigger project_create_limit_guard
before insert on public.projects
for each row execute function public.enforce_project_limits();

drop trigger if exists project_update_limit_guard on public.projects;
create trigger project_update_limit_guard
before update of is_shared, archived_at on public.projects
for each row execute function public.enforce_project_limits();

drop policy if exists "Users can read own projects" on public.projects;
create policy "Users can read own projects"
  on public.projects for select to authenticated
  using (user_id = (select auth.uid()) or (is_shared and archived_at is null));
drop policy if exists "Users can create own projects" on public.projects;
create policy "Users can create own projects"
  on public.projects for insert to authenticated
  with check (user_id = (select auth.uid()) and system_key is null and not is_shared);

create or replace function public.set_project_shared(p_project_id uuid, p_is_shared boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_claimed_at timestamptz;
begin
  if v_user_id is null then raise exception 'Sign in to change project sharing'; end if;
  if not exists (
    select 1 from public.profiles p where p.id = v_user_id
      and lower(p.email) ~ '^[^@]+@pmiloc[.]org$'
  ) then raise exception 'Only @pmiloc.org accounts can share projects'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':project-limits', 19));
  select p.claimed_once_at into v_claimed_at from public.projects p
  where p.id = p_project_id and p.user_id = v_user_id and p.system_key is null and p.archived_at is null
  for update;
  if not found then raise exception 'Only your active projects can be shared'; end if;
  if not p_is_shared and v_claimed_at is not null then
    raise exception 'A project used for a shared booking must stay shared';
  end if;
  if p_is_shared and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.is_shared
  ) then
    if (select count(*) from public.projects p
        where p.user_id = v_user_id and p.system_key is null and p.is_shared and p.archived_at is null) >= 3 then
      raise exception 'You can share up to 3 of your projects';
    end if;
  end if;
  update public.projects set is_shared = p_is_shared where id = p_project_id;
end;
$$;
revoke all on function public.set_project_shared(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_project_shared(uuid, boolean) to authenticated;

create or replace function public.check_work_entry_allocation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare total_hours numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    new.user_id::text || ':' || new.work_date::text || ':' || new.hour_slot::text, 0
  ));
  if not exists (
    select 1 from public.projects p where p.id = new.project_id
      and (p.user_id = new.user_id or p.is_shared) and p.archived_at is null
  ) then raise exception 'Project must be active and available to the entry user'; end if;

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

create or replace function public.protect_osticket_work_entries()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare old_is_shared boolean; old_system_key text;
begin
  select p.is_shared, p.system_key into old_is_shared, old_system_key
  from public.projects p where p.id = old.project_id;
  if old_system_key = 'osticket' or old_is_shared then
    if tg_op = 'UPDATE' then raise exception 'Shared booking entries can only be changed in their shared schedule'; end if;
    if exists (select 1 from public.shared_project_claims c where c.work_entry_id = old.id) then
      raise exception 'Release the shared booking before removing its work entry';
    end if;
  end if;
  return old;
end;
$$;

drop policy if exists "Users can create own work entries" on public.work_entries;
create policy "Users can create own work entries"
  on public.work_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())
      and p.system_key is null and not p.is_shared and p.archived_at is null
  ));
drop policy if exists "Users can update own work entries" on public.work_entries;
create policy "Users can update own work entries"
  on public.work_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())
      and p.system_key is null and not p.is_shared and p.archived_at is null
  ));
drop policy if exists "Users can delete own work entries" on public.work_entries;
create policy "Users can delete own work entries"
  on public.work_entries for delete to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.projects p where p.id = project_id
      and p.system_key is distinct from 'osticket' and not p.is_shared
  ));

create or replace function public.claim_shared_project_hour(
  p_project_id uuid, p_work_date date, p_hour_slot smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_project public.projects%rowtype; v_entry_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before claiming a project hour'; end if;
  if p_work_date is null or p_hour_slot is null or p_hour_slot not between 0 and 23 then
    raise exception 'Choose a valid date and one-hour block';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id and lower(p.email) ~ '^[^@]+@pmiloc[.]org$') then
    raise exception 'Only @pmiloc.org accounts can claim shared project hours';
  end if;
  select * into v_project from public.projects p
  where p.id = p_project_id and p.is_shared and p.archived_at is null;
  if not found then raise exception 'This project is not currently shared'; end if;
  if v_project.system_key = 'osticket' and p_hour_slot not between 8 and 21 then
    raise exception 'Choose an osTicket block between 8 AM and 10 PM Toronto time';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':' || p_work_date::text || ':' || p_hour_slot::text, 0
  ));
  if exists (select 1 from public.work_entries e where e.user_id = v_user_id
      and e.work_date = p_work_date and e.hour_slot = p_hour_slot) then
    raise exception 'You already have work logged in this hour';
  end if;

  insert into public.shared_project_booked_slots (project_id, work_date, hour_slot)
  values (p_project_id, p_work_date, p_hour_slot)
  on conflict (project_id, work_date, hour_slot) do nothing;
  if not found then raise exception 'That hour is already claimed'; end if;

  insert into public.work_entries (user_id, project_id, work_date, hour_slot, allocated_hours)
  values (v_user_id, p_project_id, p_work_date, p_hour_slot, 1)
  returning id into v_entry_id;
  insert into public.shared_project_claims (project_id, work_date, hour_slot, user_id, work_entry_id)
  values (p_project_id, p_work_date, p_hour_slot, v_user_id, v_entry_id);
  update public.projects set claimed_once_at = coalesce(claimed_once_at, now()) where id = p_project_id;
end;
$$;

create or replace function public.release_shared_project_hour(
  p_project_id uuid, p_work_date date, p_hour_slot smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_entry_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before releasing a shared project hour'; end if;
  delete from public.shared_project_claims c
  where c.project_id = p_project_id and c.work_date = p_work_date
    and c.hour_slot = p_hour_slot and c.user_id = v_user_id
  returning c.work_entry_id into v_entry_id;
  if v_entry_id is null then raise exception 'You can release only your own booking'; end if;
  delete from public.work_entries e where e.id = v_entry_id and e.user_id = v_user_id;
  delete from public.shared_project_booked_slots s
  where s.project_id = p_project_id and s.work_date = p_work_date and s.hour_slot = p_hour_slot;
end;
$$;
revoke all on function public.claim_shared_project_hour(uuid, date, smallint) from public, anon, authenticated;
grant execute on function public.claim_shared_project_hour(uuid, date, smallint) to authenticated;
revoke all on function public.release_shared_project_hour(uuid, date, smallint) from public, anon, authenticated;
grant execute on function public.release_shared_project_hour(uuid, date, smallint) to authenticated;

-- Disable obsolete osTicket-only write paths after migrating active bookings.
revoke all on function public.claim_osticket_hour(date, smallint) from public, anon, authenticated;
revoke all on function public.release_osticket_hour(date, smallint) from public, anon, authenticated;

-- Future accounts get the built-in osTicket shared schedule as well.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(new.email) !~ '^[^@]+@pmiloc[.]org$' then
    raise exception 'Only @pmiloc.org accounts are allowed';
  end if;
  insert into public.profiles (id, email) values (new.id, lower(new.email));
  insert into public.projects (user_id, name, color, system_key, is_shared)
  values
    (new.id, 'osTicket', '#48A58C', 'osticket', true),
    (new.id, 'Meetings', '#5574D9', 'meetings', false),
    (new.id, 'New Website', '#B47AD5', null, false);
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'shared_project_booked_slots'
    ) then
    execute 'alter publication supabase_realtime add table public.shared_project_booked_slots';
  end if;
end;
$$;
