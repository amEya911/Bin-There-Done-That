-- Core application data, real spatial indexes, and private evidence metadata.
-- No plan changes or paid services are required by this migration.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists public.bins (
  id text primary key,
  scope text not null default 'public',
  data jsonb not null check (data->>'id' = id),
  name text generated always as (data->>'name') stored,
  source text generated always as (data->>'source') stored,
  status text generated always as (data->>'status') stored,
  approval text generated always as (data->>'approval') stored,
  location extensions.geography(point,4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint((data->>'lng')::float8,(data->>'lat')::float8),4326)::extensions.geography
  ) stored,
  check (data->>'source' in ('toronto','manual')),
  check (data->>'status' in ('Existing','Temporarily Removed')),
  check (data->>'approval' in ('approved','pending','rejected'))
);
create index if not exists bins_location_gist on public.bins using gist(location);
create index if not exists bins_scope_status on public.bins(scope,status,approval);

create table if not exists public.areas (
  id text primary key,
  scope text not null default 'public',
  data jsonb not null check (data->>'id' = id),
  active boolean generated always as ((data->>'active')::boolean) stored,
  boundary extensions.geometry(polygon,4326) generated always as (
    extensions.st_setsrid(extensions.st_geomfromgeojson(('{"type":"Polygon","coordinates":[' || (data->'polygon')::text || ']}')::jsonb),4326)
  ) stored,
  check (extensions.st_isvalid(boundary))
);
create index if not exists areas_boundary_gist on public.areas using gist(boundary);
create index if not exists areas_scope_active on public.areas(scope,active);

create table if not exists public.cases (
  id text primary key,
  scope text not null default 'public',
  data jsonb not null check (data->>'id' = id),
  bin_id text generated always as (data->>'binId') stored references public.bins(id) deferrable initially deferred,
  state text generated always as (data->>'state') stored,
  updated_at text generated always as (data->>'updatedAt') stored,
  unique (id,scope)
);
create index if not exists cases_scope_bin on public.cases(scope,bin_id,updated_at desc);
create index if not exists cases_open on public.cases(scope,state) where state not in ('work_complete','rechecked','resolved');

create table if not exists public.reports (
  id text primary key,
  scope text not null default 'public',
  data jsonb not null check (data->>'id' = id),
  case_id text generated always as (data->>'caseId') stored,
  bin_id text generated always as (data->>'binId') stored references public.bins(id) deferrable initially deferred,
  status text generated always as (data->>'status') stored,
  created_at text generated always as (data->>'createdAt') stored,
  foreign key (case_id,scope) references public.cases(id,scope) deferrable initially deferred,
  check (data->>'status' in ('active','withdrawn'))
);
create index if not exists reports_active_scope on public.reports(scope,created_at desc) where status='active';
create index if not exists reports_bin_case on public.reports(scope,bin_id,case_id,status);

create table if not exists app_private.records (
  kind text not null,
  id text not null,
  scope text not null default 'public',
  data jsonb not null check (data->>'id' = id),
  primary key (kind,id)
);
create index if not exists records_scope on app_private.records(kind,scope);
create table if not exists app_private.report_keys (
  session_id text not null,
  request_key text not null,
  report_id text not null references public.reports(id) deferrable initially deferred,
  primary key (session_id,request_key)
);
create table if not exists app_private.quotas (
  key text primary key,
  count integer not null check (count >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists app_private.media (
  id text primary key,
  object_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists media_expiry on app_private.media(expires_at);
create table if not exists app_private.migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Private by default: browsers use the Next.js API's public projections.
-- Never expose session hashes, receipt secrets, notes, or evidence to anon.
alter table public.bins enable row level security;
alter table public.areas enable row level security;
alter table public.cases enable row level security;
alter table public.reports enable row level security;
alter table app_private.records enable row level security;
alter table app_private.report_keys enable row level security;
alter table app_private.quotas enable row level security;
alter table app_private.media enable row level security;
alter table app_private.migrations enable row level security;
revoke all on public.bins,public.areas,public.cases,public.reports from anon,authenticated;
revoke all on all tables in schema app_private from anon,authenticated;

-- Private Storage bucket. Only the backend uses the server secret to read/write.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('bin-evidence','bin-evidence',false,8388608,array['image/jpeg'])
on conflict (id) do nothing;
insert into app_private.migrations(version) values ('20261024131240') on conflict do nothing;
