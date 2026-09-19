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
  tagline text not null default 'Estilo que te define',
  address text not null default 'Magallanes 436',
  city text not null default 'Tandil',
  logo_url text not null default '',
  whatsapp_business text not null default '',
  reminder_hours integer not null default 24 check (reminder_hours in (3,12,24)),
  slot_step_minutes integer not null default 15 check (slot_step_minutes in (5,10,15,20,30,60)),
  cleaning_buffer_minutes integer not null default 15 check (cleaning_buffer_minutes between 0 and 120),
  booking_horizon_days integer not null default 30 check (booking_horizon_days between 1 and 365),
  minimum_notice_minutes integer not null default 30 check (minimum_notice_minutes between 0 and 10080),
  updated_at timestamptz not null default now()
);

alter table public.settings add column if not exists tagline text not null default 'Estilo que te define';
alter table public.settings add column if not exists city text not null default 'Tandil';
alter table public.settings add column if not exists logo_url text not null default '';
alter table public.settings add column if not exists minimum_notice_minutes integer not null default 30;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.settings (id) values (1)
on conflict (id) do nothing;

create table if not exists public.business_hours (
  day_of_week smallint primary key check (day_of_week between 1 and 7),
  is_open boolean not null default true,
  open_time time not null default '09:00',
  close_time time not null default '20:00',
  updated_at timestamptz not null default now(),
  check (close_time > open_time)
);

insert into public.business_hours(day_of_week,is_open,open_time,close_time)
values
  (1,false,'09:00','20:00'),
  (2,true,'09:00','20:00'),
  (3,true,'09:00','20:00'),
  (4,true,'09:00','20:00'),
  (5,true,'09:00','20:00'),
  (6,true,'09:00','20:00'),
  (7,false,'09:00','20:00')
on conflict (day_of_week) do nothing;

create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  block_date date not null,
  professional_id uuid references public.professionals(id) on delete cascade,
  start_time time,
  end_time time,
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (
    (start_time is null and end_time is null)
    or
    (start_time is not null and end_time is not null and end_time > start_time)
  )
);

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
alter table public.business_hours enable row level security;
alter table public.schedule_blocks enable row level security;

-- Remove old policies safely.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname='public'
             and tablename in ('services','professionals','professional_services','clients','appointments','settings','admin_users','business_hours','schedule_blocks')
  loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

revoke all on public.services, public.professionals, public.professional_services,
  public.clients, public.appointments, public.settings, public.admin_users,
  public.business_hours, public.schedule_blocks
from anon, authenticated;

grant select on public.services, public.professionals, public.professional_services, public.settings, public.business_hours to anon, authenticated;
grant select, insert, update, delete on public.services, public.professionals, public.professional_services,
  public.clients, public.appointments to authenticated;
grant update on public.settings to authenticated;
grant select, insert, update, delete on public.business_hours, public.schedule_blocks to authenticated;
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

create policy "public business hours"
on public.business_hours for select to anon, authenticated
using (true);

create policy "admin business hours"
on public.business_hours for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "admin schedule blocks"
on public.schedule_blocks for all to authenticated
using (public.is_admin()) with check (public.is_admin());

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
  select slot_step_minutes, cleaning_buffer_minutes, booking_horizon_days, minimum_notice_minutes
  from public.settings where id=1
),
hours as (
  select open_time, close_time
  from public.business_hours
  where day_of_week=extract(isodow from p_date)::int and is_open
),
svc as (
  select id, duration_minutes from public.services where id=p_service_id and active
),
slots as (
  select gs::time as slot_time,
         gs as slot_start,
         gs + make_interval(mins => (select duration_minutes from svc)) as service_end
  from cfg, hours, svc,
  lateral generate_series(
    p_date + hours.open_time,
    p_date + hours.close_time - make_interval(mins => cfg.slot_step_minutes),
    make_interval(mins => cfg.slot_step_minutes)
  ) gs
  where p_date >= current_date
    and p_date <= current_date + cfg.booking_horizon_days
    and gs >= now() + make_interval(mins => cfg.minimum_notice_minutes)
),
candidates as (
  select s.slot_time, p.id professional_id, p.name professional_name, s.slot_start, s.service_end
  from slots s
  join public.professionals p on p.active
  where (p_professional_id is null or p.id=p_professional_id)
    and (
      not exists(select 1 from public.professional_services x where x.service_id=p_service_id)
      or exists(select 1 from public.professional_services x where x.service_id=p_service_id and x.professional_id=p.id)
    )
    and not exists (
      select 1 from public.schedule_blocks b
      where b.block_date=p_date
        and (b.professional_id is null or b.professional_id=p.id)
        and (
          (b.start_time is null and b.end_time is null)
          or
          (
            s.slot_start < (p_date + b.end_time)
            and (p_date + b.start_time) < s.service_end
          )
        )
    )
    and not exists (
      select 1 from public.appointments a, cfg
      where a.professional_id=p.id
        and a.appointment_date=p_date
        and a.status <> 'cancelled'
        and s.slot_start < (a.appointment_date + a.appointment_time
            + make_interval(mins => a.duration_minutes + cfg.cleaning_buffer_minutes))
        and (a.appointment_date + a.appointment_time) < s.service_end
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
  v_horizon integer;
  v_notice integer;
  v_open time;
  v_close time;
  v_prof public.professionals%rowtype;
  v_client uuid;
  v_appt uuid;
  v_start timestamp;
  v_service_end timestamp;
begin
  if nullif(trim(p_client_name),'') is null or nullif(trim(p_client_whatsapp),'') is null then
    raise exception 'Nombre y WhatsApp son obligatorios';
  end if;

  select duration_minutes into v_duration
  from public.services where id=p_service_id and active;
  if v_duration is null then raise exception 'Servicio no disponible'; end if;

  select cleaning_buffer_minutes, booking_horizon_days, minimum_notice_minutes
  into v_buffer, v_horizon, v_notice
  from public.settings where id=1;

  select open_time, close_time into v_open, v_close
  from public.business_hours
  where day_of_week=extract(isodow from p_date)::int and is_open;

  if v_open is null then raise exception 'Fecha no disponible'; end if;

  if p_date < current_date or p_date > current_date + v_horizon then
    raise exception 'Fecha no disponible';
  end if;

  v_start := p_date + p_time;
  v_service_end := v_start + make_interval(mins => v_duration);

  if p_time < v_open or p_time >= v_close
     or v_start < now() + make_interval(mins => v_notice) then
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

    if exists (
      select 1 from public.schedule_blocks b
      where b.block_date=p_date
        and (b.professional_id is null or b.professional_id=v_prof.id)
        and (
          (b.start_time is null and b.end_time is null)
          or
          (
            v_start < (p_date + b.end_time)
            and (p_date + b.start_time) < v_service_end
          )
        )
    ) then
      continue;
    end if;

    if not exists (
      select 1 from public.appointments a
      where a.professional_id=v_prof.id
        and a.appointment_date=p_date
        and a.status <> 'cancelled'
        and v_start < (a.appointment_date + a.appointment_time
            + make_interval(mins => a.duration_minutes + v_buffer))
        and (a.appointment_date + a.appointment_time) < v_service_end
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


-- Security/performance hardening for Barshi Turnos

drop policy if exists "public active services" on public.services;
drop policy if exists "admin services" on public.services;
create policy "services select"
on public.services for select to anon, authenticated
using (
  active
  or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);
create policy "services insert admin"
on public.services for insert to authenticated
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "services update admin"
on public.services for update to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "services delete admin"
on public.services for delete to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "public active professionals" on public.professionals;
drop policy if exists "admin professionals" on public.professionals;
create policy "professionals select"
on public.professionals for select to anon, authenticated
using (
  active
  or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);
create policy "professionals insert admin"
on public.professionals for insert to authenticated
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "professionals update admin"
on public.professionals for update to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "professionals delete admin"
on public.professionals for delete to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "public professional services" on public.professional_services;
drop policy if exists "admin professional services" on public.professional_services;
create policy "professional services select"
on public.professional_services for select to anon, authenticated using (true);
create policy "professional services insert admin"
on public.professional_services for insert to authenticated
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "professional services update admin"
on public.professional_services for update to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "professional services delete admin"
on public.professional_services for delete to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "public business hours" on public.business_hours;
drop policy if exists "admin business hours" on public.business_hours;
create policy "business hours select"
on public.business_hours for select to anon, authenticated using (true);
create policy "business hours insert admin"
on public.business_hours for insert to authenticated
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "business hours update admin"
on public.business_hours for update to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));
create policy "business hours delete admin"
on public.business_hours for delete to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "own admin row" on public.admin_users;
create policy "own admin row"
on public.admin_users for select to authenticated
using (user_id = (select auth.uid()));

revoke execute on function public.is_admin() from public, anon, authenticated;

create index if not exists idx_appointments_client_id on public.appointments(client_id);
create index if not exists idx_appointments_service_id on public.appointments(service_id);
create index if not exists idx_professional_services_service_id on public.professional_services(service_id);
create index if not exists idx_schedule_blocks_professional_id on public.schedule_blocks(professional_id);


-- Final RLS split: public vs admin
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.admin_users au
    where au.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

drop policy if exists "services select" on public.services;
drop policy if exists "services public select" on public.services;
drop policy if exists "services authenticated select" on public.services;
drop policy if exists "services insert admin" on public.services;
drop policy if exists "services update admin" on public.services;
drop policy if exists "services delete admin" on public.services;
create policy "services public select" on public.services for select to anon using (active);
create policy "services authenticated select" on public.services for select to authenticated using (active or (select private.is_admin()));
create policy "services insert admin" on public.services for insert to authenticated with check ((select private.is_admin()));
create policy "services update admin" on public.services for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "services delete admin" on public.services for delete to authenticated using ((select private.is_admin()));

drop policy if exists "professionals select" on public.professionals;
drop policy if exists "professionals public select" on public.professionals;
drop policy if exists "professionals authenticated select" on public.professionals;
drop policy if exists "professionals insert admin" on public.professionals;
drop policy if exists "professionals update admin" on public.professionals;
drop policy if exists "professionals delete admin" on public.professionals;
create policy "professionals public select" on public.professionals for select to anon using (active);
create policy "professionals authenticated select" on public.professionals for select to authenticated using (active or (select private.is_admin()));
create policy "professionals insert admin" on public.professionals for insert to authenticated with check ((select private.is_admin()));
create policy "professionals update admin" on public.professionals for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "professionals delete admin" on public.professionals for delete to authenticated using ((select private.is_admin()));

drop policy if exists "professional services select" on public.professional_services;
drop policy if exists "professional services insert admin" on public.professional_services;
drop policy if exists "professional services update admin" on public.professional_services;
drop policy if exists "professional services delete admin" on public.professional_services;
create policy "professional services select" on public.professional_services for select to anon, authenticated using (true);
create policy "professional services insert admin" on public.professional_services for insert to authenticated with check ((select private.is_admin()));
create policy "professional services update admin" on public.professional_services for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "professional services delete admin" on public.professional_services for delete to authenticated using ((select private.is_admin()));

drop policy if exists "business hours select" on public.business_hours;
drop policy if exists "business hours insert admin" on public.business_hours;
drop policy if exists "business hours update admin" on public.business_hours;
drop policy if exists "business hours delete admin" on public.business_hours;
create policy "business hours select" on public.business_hours for select to anon, authenticated using (true);
create policy "business hours insert admin" on public.business_hours for insert to authenticated with check ((select private.is_admin()));
create policy "business hours update admin" on public.business_hours for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "business hours delete admin" on public.business_hours for delete to authenticated using ((select private.is_admin()));

drop policy if exists "admin settings" on public.settings;
create policy "admin settings" on public.settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admin clients" on public.clients;
create policy "admin clients" on public.clients for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admin appointments" on public.appointments;
create policy "admin appointments" on public.appointments for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "admin schedule blocks" on public.schedule_blocks;
create policy "admin schedule blocks" on public.schedule_blocks for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

drop function if exists public.is_admin();


-- Club Barshi, promociones y validación de visitas.

alter table public.settings
  add column if not exists club_enabled boolean not null default true,
  add column if not exists club_label text not null default 'CLUB BARSHI',
  add column if not exists club_title text not null default 'Nueve visitas. La décima, por la casa.',
  add column if not exists club_legend text not null default 'Reservá siempre con el mismo WhatsApp. Barshi valida un sello después de cada corte.',
  add column if not exists club_goal integer not null default 10,
  add column if not exists club_reward_text text not null default 'GRATIS',
  add column if not exists club_badge_text text not null default 'El 10.º corte es gratis';

alter table public.clients
  add column if not exists reward_available boolean not null default false;

alter table public.clients drop constraint if exists clients_stamps_check;
alter table public.clients
  add constraint clients_stamps_check check (stamps >= 0 and stamps <= 1000);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promotions enable row level security;

revoke all on public.promotions from anon, authenticated;
grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;

drop policy if exists "promotions select" on public.promotions;
create policy "promotions select"
on public.promotions for select to anon, authenticated
using (
  active
  or exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);

drop policy if exists "promotions insert admin" on public.promotions;
create policy "promotions insert admin"
on public.promotions for insert to authenticated
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "promotions update admin" on public.promotions;
create policy "promotions update admin"
on public.promotions for update to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "promotions delete admin" on public.promotions;
create policy "promotions delete admin"
on public.promotions for delete to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "admin clients" on public.clients;
create policy "admin clients"
on public.clients for all to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "admin appointments" on public.appointments;
create policy "admin appointments"
on public.appointments for all to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "admin settings" on public.settings;
create policy "admin settings"
on public.settings for update to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

drop policy if exists "admin schedule blocks" on public.schedule_blocks;
create policy "admin schedule blocks"
on public.schedule_blocks for all to authenticated
using (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())))
with check (exists (select 1 from public.admin_users au where au.user_id = (select auth.uid())));

create or replace function public.validate_appointment_visit(p_appointment_id uuid)
returns table(stamps integer, reward_available boolean, club_goal integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_status text;
  v_goal integer;
  v_stamps integer;
  v_reward boolean;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'Sin permisos de administración';
  end if;

  select a.client_id, a.status into v_client, v_status
  from public.appointments a where a.id = p_appointment_id for update;

  if v_client is null then raise exception 'Turno sin cliente asociado'; end if;
  if v_status = 'cancelled' then raise exception 'No se puede validar un turno cancelado'; end if;

  select greatest(s.club_goal,2) into v_goal from public.settings s where s.id=1;
  select c.stamps, c.reward_available into v_stamps, v_reward
  from public.clients c where c.id=v_client for update;

  if v_status <> 'completed' then
    update public.appointments set status='completed' where id=p_appointment_id;
    if not v_reward then
      v_stamps := least(v_stamps + 1, v_goal - 1);
      if v_stamps >= v_goal - 1 then v_reward := true; end if;
      update public.clients
      set stamps=v_stamps, reward_available=v_reward, updated_at=now()
      where id=v_client;
    end if;
  end if;

  return query select v_stamps, v_reward, v_goal;
end;
$$;

create or replace function public.redeem_appointment_reward(p_appointment_id uuid)
returns table(stamps integer, reward_available boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_status text;
  v_reward boolean;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'Sin permisos de administración';
  end if;

  select a.client_id, a.status into v_client, v_status
  from public.appointments a where a.id=p_appointment_id for update;

  if v_client is null then raise exception 'Turno sin cliente asociado'; end if;
  if v_status='cancelled' then raise exception 'No se puede canjear en un turno cancelado'; end if;

  select c.reward_available into v_reward
  from public.clients c where c.id=v_client for update;

  if not coalesce(v_reward,false) then
    raise exception 'El cliente todavía no tiene un beneficio disponible';
  end if;

  update public.appointments set status='completed' where id=p_appointment_id;
  update public.clients
  set stamps=0, reward_available=false, updated_at=now()
  where id=v_client;

  return query select 0, false;
end;
$$;

revoke execute on function public.validate_appointment_visit(uuid) from public, anon;
revoke execute on function public.redeem_appointment_reward(uuid) from public, anon;
grant execute on function public.validate_appointment_visit(uuid) to authenticated;
grant execute on function public.redeem_appointment_reward(uuid) to authenticated;

create index if not exists idx_promotions_active_sort
on public.promotions(active, sort_order);


-- Enlaces privados de Mi Club Barshi
alter table public.clients
  add column if not exists club_access_token uuid default gen_random_uuid();

update public.clients
set club_access_token = gen_random_uuid()
where club_access_token is null;

alter table public.clients
  alter column club_access_token set not null;

create unique index if not exists idx_clients_club_access_token
on public.clients(club_access_token);

create or replace function public.get_club_status(p_token uuid)
returns table(
  client_name text,
  stamps integer,
  reward_available boolean,
  club_goal integer,
  club_label text,
  club_title text,
  club_legend text,
  club_reward_text text,
  next_date date,
  next_time time,
  next_service text,
  next_professional text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    split_part(c.full_name, ' ', 1),
    c.stamps,
    c.reward_available,
    greatest(s.club_goal,2),
    s.club_label,
    s.club_title,
    s.club_legend,
    s.club_reward_text,
    nxt.appointment_date,
    nxt.appointment_time,
    nxt.service_name,
    nxt.professional_name
  from public.clients c
  cross join public.settings s
  left join lateral (
    select
      a.appointment_date,
      a.appointment_time,
      sv.name as service_name,
      p.name as professional_name
    from public.appointments a
    join public.services sv on sv.id = a.service_id
    join public.professionals p on p.id = a.professional_id
    where a.client_id = c.id
      and a.status = 'confirmed'
      and (a.appointment_date + a.appointment_time) >= now()
    order by a.appointment_date, a.appointment_time
    limit 1
  ) nxt on true
  where c.club_access_token = p_token
  limit 1;
$$;

revoke all on function public.get_club_status(uuid) from public;
grant execute on function public.get_club_status(uuid) to anon, authenticated;

create or replace function public.rotate_club_access_token(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not exists (
    select 1 from public.admin_users au
    where au.user_id = auth.uid()
  ) then
    raise exception 'Sin permisos de administración';
  end if;

  v_token := gen_random_uuid();

  update public.clients
  set club_access_token = v_token,
      updated_at = now()
  where id = p_client_id;

  if not found then
    raise exception 'Cliente no encontrado';
  end if;

  return v_token;
end;
$$;

revoke all on function public.rotate_club_access_token(uuid) from public, anon;
grant execute on function public.rotate_club_access_token(uuid) to authenticated;


-- Registro manual de visitas anteriores
create or replace function public.register_manual_visit(
  p_client_name text,
  p_client_whatsapp text,
  p_service_id uuid,
  p_professional_id uuid,
  p_date date,
  p_time time default '12:00'::time
)
returns table(
  appointment_id uuid,
  stamps integer,
  reward_available boolean,
  club_goal integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_duration integer;
  v_goal integer;
  v_stamps integer;
  v_reward boolean;
  v_appt uuid;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_now_time time := (now() at time zone 'America/Argentina/Buenos_Aires')::time;
begin
  if not exists (
    select 1 from public.admin_users au
    where au.user_id = auth.uid()
  ) then
    raise exception 'Sin permisos de administración';
  end if;

  if nullif(trim(p_client_name),'') is null
     or nullif(trim(p_client_whatsapp),'') is null then
    raise exception 'Nombre y WhatsApp son obligatorios';
  end if;

  if p_date > v_today then
    raise exception 'La visita manual no puede ser futura';
  end if;

  if p_date = v_today and p_time > v_now_time then
    raise exception 'La hora de una visita manual de hoy no puede ser futura';
  end if;

  select s.duration_minutes
  into v_duration
  from public.services s
  where s.id=p_service_id;

  if v_duration is null then
    raise exception 'Servicio no encontrado';
  end if;

  if not exists (
    select 1 from public.professionals p
    where p.id=p_professional_id
  ) then
    raise exception 'Profesional no encontrado';
  end if;

  insert into public.clients(full_name, whatsapp)
  values(trim(p_client_name), trim(p_client_whatsapp))
  on conflict (whatsapp)
  do update set
    full_name=excluded.full_name,
    updated_at=now()
  returning id into v_client;

  insert into public.appointments(
    client_id, client_name, client_whatsapp, service_id, professional_id,
    appointment_date, appointment_time, duration_minutes, status
  )
  values(
    v_client, trim(p_client_name), trim(p_client_whatsapp),
    p_service_id, p_professional_id, p_date, coalesce(p_time,'12:00'::time),
    v_duration, 'completed'
  )
  returning id into v_appt;

  select greatest(s.club_goal,2)
  into v_goal
  from public.settings s
  where s.id=1;

  select c.stamps, c.reward_available
  into v_stamps, v_reward
  from public.clients c
  where c.id=v_client
  for update;

  if not v_reward then
    v_stamps := least(v_stamps + 1, v_goal - 1);
    if v_stamps >= v_goal - 1 then
      v_reward := true;
    end if;

    update public.clients
    set stamps=v_stamps,
        reward_available=v_reward,
        updated_at=now()
    where id=v_client;
  end if;

  return query select v_appt, v_stamps, v_reward, v_goal;
end;
$$;

revoke all on function public.register_manual_visit(text,text,uuid,uuid,date,time) from public, anon;
grant execute on function public.register_manual_visit(text,text,uuid,uuid,date,time) to authenticated;


-- Notificaciones push para administradores
create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_push_subscriptions enable row level security;

create policy "push subscriptions select own admin"
on public.admin_push_subscriptions for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);

create policy "push subscriptions insert own admin"
on public.admin_push_subscriptions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);

create policy "push subscriptions update own admin"
on public.admin_push_subscriptions for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);

create policy "push subscriptions delete own admin"
on public.admin_push_subscriptions for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (select 1 from public.admin_users au where au.user_id = (select auth.uid()))
);

create table if not exists public.push_config (
  id integer primary key check (id=1),
  public_key text not null,
  private_key text not null,
  subject text not null,
  updated_at timestamptz not null default now()
);
alter table public.push_config enable row level security;
-- Las claves VAPID se configuran únicamente en la base de datos de producción.

alter table public.appointments
  add column if not exists push_notified_at timestamptz;

create index if not exists idx_push_subscriptions_user
on public.admin_push_subscriptions(user_id);


-- Aviso inmediato de nuevas reservas
create extension if not exists pg_net;

create or replace function public.notify_new_booking_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' then
    perform net.http_post(
      url := 'https://vzpeofhmqrumcgwzwkkr.supabase.co/functions/v1/notify-booking',
      body := jsonb_build_object('appointment_id', new.id),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_p8C4f1CPFc5nSn7c-zVTHA_qYzcLYzn'
      ),
      timeout_milliseconds := 5000
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_booking_push on public.appointments;
create trigger trg_notify_new_booking_push
after insert on public.appointments
for each row
execute function public.notify_new_booking_push();
