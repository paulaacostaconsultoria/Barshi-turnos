-- BARSHI Barber · Supabase production schema
-- Execute in Supabase > SQL Editor.
-- After creating the first admin user in Authentication, add that user's UUID
-- to public.admin_users (instructions at the bottom).

create extension if not exists "pgcrypto";

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 480),
  price numeric(12,2) not null check (price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professional_services (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (professional_id, service_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  whatsapp text not null unique,
  stamps integer not null default 0 check (stamps between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  client_whatsapp text not null,
  service_id uuid not null references public.services(id),
  professional_id uuid not null references public.professionals(id),
  appointment_date date not null,
  appointment_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status text not null default 'confirmed'
    check (status in ('confirmed','cancelled','completed','no_show')),
  whatsapp_confirmation_sent boolean not null default false,
  whatsapp_reminder_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'Barshi Barber',
  address text not null default 'Magallanes 436, Tandil',
  whatsapp_business text not null default '',
  reminder_hours integer not null default 24 check (reminder_hours in (3,12,24)),
  open_time time not null default '09:00',
  close_time time not null default '20:00',
  slot_step_minutes integer not null default 15 check (slot_step_minutes in (5,10,15,20,30,60)),
  cleaning_buffer_minutes integer not null default 15 check (cleaning_buffer_minutes between 0 and 120),
  booking_horizon_days integer not null default 30 check (booking_horizon_days between 1 and 365),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.settings (id) values (1)
on conflict (id) do nothing;

insert into public.services (name, description, duration_minutes, price, sort_order)
select * from (values
  ('Corte clásico','Asesoramiento, corte y terminación.',60,12000,1),
  ('Perfilado de barba','Diseño, perfilado y cuidado.',30,9000,2),
  ('Corte + barba','La experiencia Barshi completa.',70,18000,3)
) as seed(name, description, duration_minutes, price, sort_order)
where not exists (select 1 from public.services);

insert into public.professionals (name, active)
select * from (values ('Nicolás',true),('Franco',true)) as seed(name,active)
where not exists (select 1 from public.professionals);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users au where au.user_id = auth.uid());
$$;

alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.settings enable row level security;
alter table public.admin_users enable row level security;

-- Remove old policies safely.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname='public'
             and tablename in ('services','professionals','professional_services','clients','appointments','settings','admin_users')
  loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

revoke all on public.services, public.professionals, public.professional_services,
  public.clients, public.appointments, public.settings, public.admin_users
from anon, authenticated;

grant select on public.services, public.professionals, public.professional_services, public.settings to anon, authenticated;
grant select, insert, update, delete on public.services, public.professionals, public.professional_services,
  public.clients, public.appointments to authenticated;
grant update on public.settings to authenticated;
grant select on public.admin_users to authenticated;

create policy "public active services"
on public.services for select to anon, authenticated
using (active or public.is_admin());

create policy "admin services"
on public.services for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "public active professionals"
on public.professionals for select to anon, authenticated
using (active or public.is_admin());

create policy "admin professionals"
on public.professionals for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "public professional services"
on public.professional_services for select to anon, authenticated
using (true);

create policy "admin professional services"
on public.professional_services for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "public settings"
on public.settings for select to anon, authenticated
using (true);

create policy "admin settings"
on public.settings for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "admin clients"
on public.clients for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "admin appointments"
on public.appointments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "own admin row"
on public.admin_users for select to authenticated
using (user_id = auth.uid());

-- Public availability without exposing client names/phones.
create or replace function public.available_slots(
  p_date date,
  p_service_id uuid,
  p_professional_id uuid default null
)
returns table(slot_time time, professional_id uuid, professional_name text)
language sql
stable
security definer
set search_path = public
as $$
with cfg as (
  select open_time, close_time, slot_step_minutes, cleaning_buffer_minutes, booking_horizon_days
  from public.settings where id=1
),
svc as (
  select id, duration_minutes from public.services where id=p_service_id and active
),
slots as (
  select gs::time as slot_time,
         gs as slot_start,
         gs + make_interval(mins => (select duration_minutes from svc) + (select cleaning_buffer_minutes from cfg)) as blocked_end
  from cfg, svc,
  lateral generate_series(
    p_date + cfg.open_time,
    p_date + cfg.close_time - make_interval(mins => svc.duration_minutes + cfg.cleaning_buffer_minutes),
    make_interval(mins => cfg.slot_step_minutes)
  ) gs
  where p_date >= current_date
    and p_date <= current_date + cfg.booking_horizon_days
    and extract(isodow from p_date) between 2 and 6
    and (p_date > current_date or gs > now())
),
candidates as (
  select s.slot_time, p.id professional_id, p.name professional_name, s.slot_start, s.blocked_end
  from slots s
  join public.professionals p on p.active
  where (p_professional_id is null or p.id=p_professional_id)
    and (
      not exists(select 1 from public.professional_services x where x.service_id=p_service_id)
      or exists(select 1 from public.professional_services x where x.service_id=p_service_id and x.professional_id=p.id)
    )
    and not exists (
      select 1 from public.appointments a, cfg
      where a.professional_id=p.id
        and a.appointment_date=p_date
        and a.status <> 'cancelled'
        and s.slot_start < (a.appointment_date + a.appointment_time
            + make_interval(mins => a.duration_minutes + cfg.cleaning_buffer_minutes))
        and (a.appointment_date + a.appointment_time) < s.blocked_end
    )
)
select distinct on (slot_time) slot_time, professional_id, professional_name
from candidates
order by slot_time, professional_name;
$$;

create or replace function public.book_appointment(
  p_service_id uuid,
  p_professional_id uuid,
  p_date date,
  p_time time,
  p_client_name text,
  p_client_whatsapp text
)
returns table(appointment_id uuid, professional_id uuid, professional_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duration integer;
  v_buffer integer;
  v_open time;
  v_close time;
  v_horizon integer;
  v_prof public.professionals%rowtype;
  v_client uuid;
  v_appt uuid;
  v_start timestamp;
  v_end timestamp;
begin
  if nullif(trim(p_client_name),'') is null or nullif(trim(p_client_whatsapp),'') is null then
    raise exception 'Nombre y WhatsApp son obligatorios';
  end if;

  select duration_minutes into v_duration
  from public.services where id=p_service_id and active;
  if v_duration is null then raise exception 'Servicio no disponible'; end if;

  select cleaning_buffer_minutes, open_time, close_time, booking_horizon_days
  into v_buffer, v_open, v_close, v_horizon
  from public.settings where id=1;

  if p_date < current_date or p_date > current_date + v_horizon
     or extract(isodow from p_date) not between 2 and 6 then
    raise exception 'Fecha no disponible';
  end if;

  v_start := p_date + p_time;
  v_end := v_start + make_interval(mins => v_duration + v_buffer);
  if p_time < v_open or v_end > p_date + v_close or v_start <= now() then
    raise exception 'Horario no disponible';
  end if;

  for v_prof in
    select p.* from public.professionals p
    where p.active
      and (p_professional_id is null or p.id=p_professional_id)
      and (
        not exists(select 1 from public.professional_services x where x.service_id=p_service_id)
        or exists(select 1 from public.professional_services x where x.service_id=p_service_id and x.professional_id=p.id)
      )
    order by p.name
  loop
    perform pg_advisory_xact_lock(hashtextextended(p_date::text || ':' || v_prof.id::text,0));
    if not exists (
      select 1 from public.appointments a
      where a.professional_id=v_prof.id
        and a.appointment_date=p_date
        and a.status <> 'cancelled'
        and v_start < (a.appointment_date + a.appointment_time
            + make_interval(mins => a.duration_minutes + v_buffer))
        and (a.appointment_date + a.appointment_time) < v_end
    ) then
      insert into public.clients(full_name, whatsapp)
      values(trim(p_client_name),trim(p_client_whatsapp))
      on conflict (whatsapp) do update set full_name=excluded.full_name, updated_at=now()
      returning id into v_client;

      insert into public.appointments(
        client_id, client_name, client_whatsapp, service_id, professional_id,
        appointment_date, appointment_time, duration_minutes
      ) values (
        v_client, trim(p_client_name), trim(p_client_whatsapp), p_service_id, v_prof.id,
        p_date, p_time, v_duration
      ) returning id into v_appt;

      return query select v_appt, v_prof.id, v_prof.name;
      return;
    end if;
  end loop;
  raise exception 'El horario ya no está disponible';
end;
$$;

revoke all on function public.available_slots(date,uuid,uuid) from public;
revoke all on function public.book_appointment(uuid,uuid,date,time,text,text) from public;
grant execute on function public.available_slots(date,uuid,uuid) to anon, authenticated;
grant execute on function public.book_appointment(uuid,uuid,date,time,text,text) to anon, authenticated;

create index if not exists idx_appointments_date_time on public.appointments(appointment_date, appointment_time);
create index if not exists idx_appointments_professional_date on public.appointments(professional_id, appointment_date);
create index if not exists idx_clients_whatsapp on public.clients(whatsapp);

-- FIRST ADMIN SETUP
-- 1) Create the admin user in Supabase > Authentication > Users.
-- 2) Copy its UUID and run:
-- insert into public.admin_users(user_id) values ('PASTE-USER-UUID-HERE');
