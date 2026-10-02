-- Keep the system osTicket row that signup creates for each account private.
-- The app uses one shared osTicket row across the team.
create or replace function public.prevent_duplicate_shared_schedule_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_shared and new.system_key is null then
    perform pg_advisory_xact_lock(hashtextextended('shared-schedule-name:' || lower(btrim(new.name)), 19));

    if exists (
      select 1
      from public.projects p
      where p.id is distinct from new.id
        and p.archived_at is null
        and (p.is_shared or p.system_key is not null)
        and lower(btrim(p.name)) = lower(btrim(new.name))
    ) then
      raise exception 'A shared schedule with this name already exists';
    end if;
  end if;

  return new;
end;
$$;

-- New accounts still get their protected osTicket project, but it is not a
-- second shared schedule. The active shared osTicket row is the team schedule.
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
    (new.id, 'osTicket', '#48A58C', 'osticket', false),
    (new.id, 'Meetings', '#5574D9', 'meetings', false),
    (new.id, 'New Website', '#B47AD5', null, false);
  return new;
end;
$$;
