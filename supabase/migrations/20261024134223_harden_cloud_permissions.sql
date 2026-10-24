-- The dashboard advisor identified an existing RLS event-trigger helper exposed
-- as an RPC. It is internal infrastructure, never a browser-callable endpoint.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
  end if;
end $$;

-- Foreign-key lookups need their own leading-column indexes; scope-first
-- dashboard indexes do not cover deletion/constraint checks by these keys.
create index if not exists cases_bin_fk on public.cases(bin_id);
create index if not exists reports_bin_fk on public.reports(bin_id);
create index if not exists reports_case_scope_fk on public.reports(case_id,scope);
create index if not exists report_keys_report_fk on app_private.report_keys(report_id);
insert into app_private.migrations(version) values('20261024134223') on conflict do nothing;
