-- Consolidate per-account osTicket bookings onto the oldest active shared
-- osTicket project. Keep each booking's owner and dates, then make the extra
-- protected rows private so new signups and the sidebar use one shared row.
begin;

do $$
declare
  v_target_id uuid;
  v_source_id uuid;
begin
  select p.id into v_target_id
  from public.projects p
  where p.system_key = 'osticket'
    and p.is_shared
    and p.archived_at is null
  order by p.created_at, p.id
  limit 1;

  if v_target_id is null then
    raise exception 'No active shared osTicket schedule was found';
  end if;

  if exists (
    select 1
    from public.shared_project_booked_slots source_slot
    join public.projects source_project on source_project.id = source_slot.project_id
    join public.shared_project_booked_slots target_slot
      on target_slot.project_id = v_target_id
      and target_slot.work_date = source_slot.work_date
      and target_slot.hour_slot = source_slot.hour_slot
    where source_project.system_key = 'osticket'
      and source_project.archived_at is null
      and source_project.id <> v_target_id
  ) then
    raise exception 'osTicket schedules contain overlapping bookings; no rows were changed';
  end if;

  if exists (
    select 1
    from public.shared_project_booked_slots source_slot
    join public.projects source_project on source_project.id = source_slot.project_id
    where source_project.system_key = 'osticket'
      and source_project.archived_at is null
      and source_project.id <> v_target_id
      and not exists (
        select 1 from public.shared_project_claims c
        where c.project_id = source_slot.project_id
          and c.work_date = source_slot.work_date
          and c.hour_slot = source_slot.hour_slot
      )
  ) then
    raise exception 'An osTicket schedule has unclaimed reserved slots; no rows were changed';
  end if;

  if exists (
    select 1
    from public.shared_project_claims c
    join public.projects source_project on source_project.id = c.project_id
    join public.work_entries e on e.id = c.work_entry_id
    where source_project.system_key = 'osticket'
      and source_project.archived_at is null
      and source_project.id <> v_target_id
      and (e.project_id <> c.project_id or e.user_id <> c.user_id)
  ) then
    raise exception 'An osTicket claim does not match its work entry; no rows were changed';
  end if;
end;
$$;

alter table public.work_entries disable trigger protect_osticket_work_entries_guard;
alter table public.projects disable trigger protect_system_projects_guard;

do $$
declare
  v_target_id uuid;
  v_source_id uuid;
begin
  select p.id into v_target_id
  from public.projects p
  where p.system_key = 'osticket'
    and p.is_shared
    and p.archived_at is null
  order by p.created_at, p.id
  limit 1;

  for v_source_id in
    select p.id
    from public.projects p
    where p.system_key = 'osticket'
      and p.archived_at is null
      and p.id <> v_target_id
    order by p.created_at, p.id
  loop
    insert into public.shared_project_booked_slots (project_id, work_date, hour_slot)
    select v_target_id, s.work_date, s.hour_slot
    from public.shared_project_booked_slots s
    where s.project_id = v_source_id
    on conflict (project_id, work_date, hour_slot) do nothing;

    update public.work_entries e
    set project_id = v_target_id
    from public.shared_project_claims c
    where c.project_id = v_source_id
      and c.work_entry_id = e.id;

    update public.shared_project_claims
    set project_id = v_target_id
    where project_id = v_source_id;

    delete from public.shared_project_booked_slots
    where project_id = v_source_id;

    update public.projects
    set is_shared = false
    where id = v_source_id;
  end loop;
end;
$$;

alter table public.work_entries enable trigger protect_osticket_work_entries_guard;
alter table public.projects enable trigger protect_system_projects_guard;

commit;
