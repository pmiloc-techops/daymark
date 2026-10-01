-- Shared schedules must have distinct names. This also reserves the names of
-- protected schedules such as osTicket when another user creates a shared one.
create or replace function public.prevent_duplicate_shared_schedule_names()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_shared or new.system_key is not null then
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

drop trigger if exists prevent_duplicate_shared_schedule_names_guard on public.projects;
create trigger prevent_duplicate_shared_schedule_names_guard
before insert or update on public.projects
for each row execute function public.prevent_duplicate_shared_schedule_names();
