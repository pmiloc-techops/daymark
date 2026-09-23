-- osTicket blocks are limited to 8 AM through 10 PM Toronto time.
-- Keep the check at the database boundary for existing deployments too.
create or replace function public.enforce_osticket_booking_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.hour_slot < 8 or new.hour_slot > 21 then
    raise exception 'Choose a block between 8 AM and 10 PM Toronto time';
  end if;
  return new;
end;
$$;

drop trigger if exists osticket_booking_window_guard on public.osticket_booked_slots;
create trigger osticket_booking_window_guard
before insert or update on public.osticket_booked_slots
for each row execute function public.enforce_osticket_booking_window();
