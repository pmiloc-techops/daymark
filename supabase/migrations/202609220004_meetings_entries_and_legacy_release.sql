-- Let users log ordinary private work against their protected Meetings project.
-- Keep direct inserts/updates blocked for osTicket and all shared projects.
drop policy if exists "Users can create own work entries" on public.work_entries;
create policy "Users can create own work entries"
  on public.work_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.user_id = (select auth.uid())
        and p.archived_at is null
        and (p.system_key = 'meetings' or (p.system_key is null and not p.is_shared))
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
      where p.id = project_id
        and p.user_id = (select auth.uid())
        and p.archived_at is null
        and (p.system_key = 'meetings' or (p.system_key is null and not p.is_shared))
    )
  );

-- The previous osTicket-only schema kept a second FK reference for reservations.
-- Remove that legacy reference before deleting the generated work entry.
create or replace function public.release_shared_project_hour(
  p_project_id uuid, p_work_date date, p_hour_slot smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  v_system_key text;
begin
  if v_user_id is null then
    raise exception 'Sign in before releasing a shared project hour';
  end if;

  select p.system_key into v_system_key
  from public.projects p
  where p.id = p_project_id;

  delete from public.shared_project_claims c
  where c.project_id = p_project_id
    and c.work_date = p_work_date
    and c.hour_slot = p_hour_slot
    and c.user_id = v_user_id
  returning c.work_entry_id into v_entry_id;

  if v_entry_id is null then
    raise exception 'You can release only your own booking';
  end if;

  if v_system_key = 'osticket' then
    delete from public.osticket_claims c
    where c.work_date = p_work_date
      and c.hour_slot = p_hour_slot
      and c.user_id = v_user_id
      and c.work_entry_id = v_entry_id;

    delete from public.osticket_booked_slots s
    where s.work_date = p_work_date
      and s.hour_slot = p_hour_slot;
  end if;

  delete from public.work_entries e
  where e.id = v_entry_id and e.user_id = v_user_id;

  delete from public.shared_project_booked_slots s
  where s.project_id = p_project_id
    and s.work_date = p_work_date
    and s.hour_slot = p_hour_slot;
end;
$$;

revoke all on function public.release_shared_project_hour(uuid, date, smallint) from public, anon, authenticated;
grant execute on function public.release_shared_project_hour(uuid, date, smallint) to authenticated;
