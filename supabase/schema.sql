-- Barshi Barber · Esquema inicial para Supabase
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run

create extension if not exists "pgcrypto";

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  duration_minutes integer not null check (duration_minutes > 0),
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
  stamps integer not null default 0 check (stamps >= 0 and stamps <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  client_whatsapp text not null,
  service_id uuid not null references public.services(id),
  professional_id uuid references public.professionals(id),
  appointment_date date not null,
  appointment_time time not null,
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
  whatsapp_business text default '',
  reminder_hours integer not null default 24 check (reminder_hours in (3,12,24)),
  updated_at timestamptz not null default now()
);

insert into public.settings (id)
values (1)
on conflict (id) do nothing;

insert into public.services (name, description, duration_minutes, price, sort_order)
select * from (values
  ('Corte clásico','Asesoramiento, corte y terminación.',45,12000,1),
  ('Perfilado de barba','Diseño, perfilado y cuidado.',30,9000,2),
  ('Corte + barba','La experiencia Barshi completa.',70,18000,3)
) as seed(name, description, duration_minutes, price, sort_order)
where not exists (select 1 from public.services);

insert into public.professionals (name, active)
select * from (values
  ('Nicolás', true),
  ('Franco', true)
) as seed(name, active)
where not exists (select 1 from public.professionals);

-- Seguridad
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.settings enable row level security;

revoke all on public.services from anon, authenticated;
revoke all on public.professionals from anon, authenticated;
revoke all on public.professional_services from anon, authenticated;
revoke all on public.clients from anon, authenticated;
revoke all on public.appointments from anon, authenticated;
revoke all on public.settings from anon, authenticated;

-- Público: solo lectura de servicios/profesionales/configuración y alta de turnos.
grant select on public.services to anon, authenticated;
grant select on public.professionals to anon, authenticated;
grant select on public.professional_services to anon, authenticated;
grant select on public.settings to anon, authenticated;
grant insert on public.appointments to anon, authenticated;

-- Administración: cuando agreguemos login, usuarios autenticados podrán administrar.
grant insert, update, delete on public.services to authenticated;
grant insert, update, delete on public.professionals to authenticated;
grant insert, update, delete on public.professional_services to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, update, delete on public.appointments to authenticated;
grant update on public.settings to authenticated;

create policy "public read active services"
on public.services for select
to anon, authenticated
using (active = true or auth.role() = 'authenticated');

create policy "public read active professionals"
on public.professionals for select
to anon, authenticated
using (active = true or auth.role() = 'authenticated');

create policy "public read professional services"
on public.professional_services for select
to anon, authenticated
using (true);

create policy "public read settings"
on public.settings for select
to anon, authenticated
using (true);

create policy "public create appointment"
on public.appointments for insert
to anon, authenticated
with check (
  status = 'confirmed'
  and whatsapp_confirmation_sent = false
  and whatsapp_reminder_sent = false
);

create policy "authenticated manage services"
on public.services for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage professionals"
on public.professionals for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage professional services"
on public.professional_services for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage clients"
on public.clients for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage appointments"
on public.appointments for all
to authenticated
using (true)
with check (true);

create policy "authenticated manage settings"
on public.settings for update
to authenticated
using (true)
with check (true);

create index if not exists idx_appointments_date_time
on public.appointments (appointment_date, appointment_time);

create index if not exists idx_appointments_professional
on public.appointments (professional_id, appointment_date);

create index if not exists idx_clients_whatsapp
on public.clients (whatsapp);
