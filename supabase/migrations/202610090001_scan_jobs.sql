-- Apply in the existing project's SQL editor BEFORE deploying background scans.
begin;
create table if not exists public.scan_jobs (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  metadata jsonb not null check (octet_length(metadata::text) <= 65536),
  archive text check (archive is null or octet_length(archive) <= 2796204)
);
create index if not exists scan_jobs_expiry_idx on public.scan_jobs(expires_at);
alter table public.scan_jobs enable row level security;
revoke all on public.scan_jobs from anon, authenticated;
grant select, insert, update, delete on public.scan_jobs to service_role;

create or replace function public.limit_scan_jobs() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(781329004);
  delete from public.scan_jobs where expires_at <= now();
  if not exists (select 1 from public.scan_jobs where id = new.id)
     and (select count(*) from public.scan_jobs) >= 32 then
    raise exception 'Scan storage full; retry after retained jobs expire';
  end if;
  return new;
end;
$$;
revoke all on function public.limit_scan_jobs() from public;
drop trigger if exists scan_jobs_capacity on public.scan_jobs;
create trigger scan_jobs_capacity before insert on public.scan_jobs
for each row execute function public.limit_scan_jobs();

-- Supabase Cron removes expired rows even when the site receives no requests.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('repo-janitor-expire-scan-jobs', '*/15 * * * *',
  $$delete from public.scan_jobs where expires_at <= now()$$);
commit;
