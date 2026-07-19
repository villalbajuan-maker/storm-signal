-- Large NHC cone polygons can legitimately require more than the default API statement timeout.
-- Scope the override to this backend-only enrichment function.
alter function public.enrich_cyclone_features(uuid[], integer, text)
  set statement_timeout = '60s';
