-- Apply after supabase/schema.sql. Safe to run again after a partial application.

alter table public.projects
  add column if not exists system_key text
  check (system_key in ('meetings', 'osticket'));

-- The original signup trigger created these exact names for each account.
update public.projects
set system_key = case name
  when 'Meetings' then 'meetings'
  when 'osTicket' then 'osticket'
end
where system_key is null and name in ('Meetings', 'osTicket');

create unique index if not exists projects_user_system_key_idx
  on public.projects (user_id, system_key)
  where system_key is not null;

-- Repair accounts missing either protected starter project.
insert into public.projects (user_id, name, color, system_key)
select p.id, seed.name, seed.color, seed.system_key
from public.profiles p
cross join (values
  ('osTicket'::text, '#48A58C'::text, 'osticket'::text),
  ('Meetings'::text, '#5574D9'::text, 'meetings'::text)
) as seed(name, color, system_key)
where not exists (
  select 1 from public.projects existing
  where existing.user_id = p.id and existing.system_key = seed.system_key
)
on conflict (user_id, system_key) where system_key is not null do nothing;

create or replace function public.protect_system_projects()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null then
      raise exception 'Protected projects cannot be deleted';
    end if;
    return old;
  end if;

  if old.system_key is distinct from new.system_key then
    raise exception 'Project system identity cannot be changed';
  end if;
  if old.system_key is not null and new.archived_at is not null then
    raise exception 'Meetings and osTicket projects cannot be archived';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_system_projects_guard on public.projects;
create trigger protect_system_projects_guard
before update or delete on public.projects
for each row execute function public.protect_system_projects();

create table if not exists public.osticket_booked_slots (
  work_date date not null,
  hour_slot smallint not null check (hour_slot between 0 and 23),
  created_at timestamptz not null default now(),
  primary key (work_date, hour_slot)
);

create table if not exists public.osticket_claims (
  work_date date not null,
  hour_slot smallint not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_entry_id uuid not null unique references public.work_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (work_date, hour_slot),
  foreign key (work_date, hour_slot)
    references public.osticket_booked_slots(work_date, hour_slot) on delete cascade
);

alter table public.osticket_booked_slots enable row level security;
alter table public.osticket_claims enable row level security;

drop policy if exists "Authenticated users can read osTicket availability" on public.osticket_booked_slots;
create policy "Authenticated users can read osTicket availability"
  on public.osticket_booked_slots for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Users can read own osTicket claims" on public.osticket_claims;
create policy "Users can read own osTicket claims"
  on public.osticket_claims for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.osticket_booked_slots from anon, authenticated;
grant select on public.osticket_booked_slots to authenticated;
revoke all on public.osticket_claims from anon, authenticated;
grant select on public.osticket_claims to authenticated;

-- Keep one hour of total personal work per user/date/hour under concurrent writes.
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
    select 1 from public.projects p
    where p.id = new.project_id
      and p.user_id = new.user_id
      and p.archived_at is null
  ) then
    raise exception 'Project must be active and owned by the entry user';
  end if;

  select coalesce(sum(e.allocated_hours), 0)
    into total_hours
  from public.work_entries e
  where e.user_id = new.user_id
    and e.work_date = new.work_date
    and e.hour_slot = new.hour_slot
    and e.id <> new.id;

  if total_hours + new.allocated_hours > 1 then
    raise exception 'Allocations for an hour slot cannot exceed one hour';
  end if;
  return new;
end;
$$;

-- osTicket work entries are managed by the claim/release RPCs, never by direct client writes.
create or replace function public.protect_osticket_work_entries()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare old_system_key text;
begin
  select p.system_key into old_system_key
  from public.projects p
  where p.id = old.project_id;

  if old_system_key = 'osticket' then
    if tg_op = 'UPDATE' then
      raise exception 'osTicket bookings can only be changed in the shared schedule';
    end if;
    if exists (
      select 1 from public.osticket_claims c where c.work_entry_id = old.id
    ) then
      raise exception 'Release the osTicket booking before removing its work entry';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists protect_osticket_work_entries_guard on public.work_entries;
create trigger protect_osticket_work_entries_guard
before update or delete on public.work_entries
for each row execute function public.protect_osticket_work_entries();

drop policy if exists "Users can create own work entries" on public.work_entries;
create policy "Users can create own work entries"
  on public.work_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid()) and p.system_key is null
    )
  );

drop policy if exists "Users can update own work entries" on public.work_entries;
create policy "Users can update own work entries"
  on public.work_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid()) and p.system_key is null
    )
  );

drop policy if exists "Users can delete own work entries" on public.work_entries;
create policy "Users can delete own work entries"
  on public.work_entries for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid()) and p.system_key is distinct from 'osticket'
    )
  );

drop policy if exists "Users can create own projects" on public.projects;
create policy "Users can create own projects"
  on public.projects for insert to authenticated
  with check (user_id = (select auth.uid()) and system_key is null);

create or replace function public.claim_osticket_hour(p_work_date date, p_hour_slot smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_entry_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in before claiming an osTicket hour';
  end if;
  if p_work_date is null or p_hour_slot is null or p_hour_slot not between 8 and 21 then
    raise exception 'Choose a block between 8 AM and 10 PM Toronto time';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and lower(p.email) ~ '^[^@]+@pmiloc[.]org$'
  ) then
    raise exception 'Only @pmiloc.org accounts can claim osTicket hours';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':' || p_work_date::text || ':' || p_hour_slot::text, 0
  ));

  if exists (
    select 1 from public.work_entries e
    where e.user_id = v_user_id
      and e.work_date = p_work_date
      and e.hour_slot = p_hour_slot
  ) then
    raise exception 'You already have work logged in this hour';
  end if;

  insert into public.osticket_booked_slots (work_date, hour_slot)
  values (p_work_date, p_hour_slot)
  on conflict (work_date, hour_slot) do nothing;
  if not found then
    raise exception 'That osTicket hour is already claimed';
  end if;

  select p.id into v_project_id
  from public.projects p
  where p.user_id = v_user_id and p.system_key = 'osticket' and p.archived_at is null;
  if v_project_id is null then
    raise exception 'Your protected osTicket project is unavailable';
  end if;

  insert into public.work_entries (user_id, project_id, work_date, hour_slot, allocated_hours)
  values (v_user_id, v_project_id, p_work_date, p_hour_slot, 1)
  returning id into v_entry_id;

  insert into public.osticket_claims (work_date, hour_slot, user_id, work_entry_id)
  values (p_work_date, p_hour_slot, v_user_id, v_entry_id);
end;
$$;

create or replace function public.release_osticket_hour(p_work_date date, p_hour_slot smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in before releasing an osTicket hour';
  end if;

  delete from public.osticket_claims c
  where c.work_date = p_work_date
    and c.hour_slot = p_hour_slot
    and c.user_id = v_user_id
  returning c.work_entry_id into v_entry_id;

  if v_entry_id is null then
    raise exception 'You can release only your own osTicket booking';
  end if;

  delete from public.work_entries e where e.id = v_entry_id and e.user_id = v_user_id;
  delete from public.osticket_booked_slots s
  where s.work_date = p_work_date and s.hour_slot = p_hour_slot;
end;
$$;

revoke all on function public.claim_osticket_hour(date, smallint) from public, anon, authenticated;
grant execute on function public.claim_osticket_hour(date, smallint) to authenticated;
revoke all on function public.release_osticket_hour(date, smallint) from public, anon, authenticated;
grant execute on function public.release_osticket_hour(date, smallint) to authenticated;

-- Newly registered users get the protected osTicket and Meetings projects.
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

  insert into public.profiles (id, email)
  values (new.id, lower(new.email));

  insert into public.projects (user_id, name, color, system_key)
  values
    (new.id, 'osTicket', '#48A58C', 'osticket'),
    (new.id, 'Meetings', '#5574D9', 'meetings'),
    (new.id, 'New Website', '#B47AD5', null);
  return new;
end;
$$;

-- Realtime publishes only the shared date/hour key table; it contains no claimant identity.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'osticket_booked_slots'
    ) then
    execute 'alter publication supabase_realtime add table public.osticket_booked_slots';
  end if;
end;
$$;
