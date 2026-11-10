-- search_games: rank whole-word prefix hits above in-word prefix hits.
--
-- After 20261110001000 went live, prod showed "cyberpunk" -> "cyberpunkdreams" before
-- "Cyberpunk 2077: Ultimate Edition" (both prefix hits, no reports, the shorter name has the
-- higher trigram similarity). A name that starts with the whole query followed by a
-- non-alphanumeric character (or the end) now ranks first among prefix hits.
-- Same signature, grants and SECURITY INVOKER; only the ORDER BY changes.

CREATE OR REPLACE FUNCTION public.search_games(q text, max_results integer DEFAULT 8)
RETURNS SETOF public.games
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH params AS (
    SELECT
      t.term,
      replace(replace(replace(t.term, '\', '\\'), '%', '\%'), '_', '\_') AS esc,
      least(greatest(coalesce(max_results, 8), 1), 50) AS lim
    FROM (SELECT lower(btrim(left(coalesce(q, ''), 100))) AS term) t
  )
  SELECT g.*
  FROM public.games g
  CROSS JOIN params p
  WHERE p.term <> ''
    AND g.name ILIKE '%' || p.esc || '%'
  ORDER BY
    lower(g.name) = p.term DESC,
    -- whole-word prefix: "cyberpunk" ranks "Cyberpunk 2077" above "cyberpunkdreams"
    (left(lower(g.name), length(p.term)) = p.term
      AND substr(lower(g.name), length(p.term) + 1, 1) !~ '[[:alnum:]]') DESC,
    lower(g.name) LIKE p.esc || '%' DESC,
    position(' ' || p.term IN ' ' || lower(g.name)) > 0 DESC,
    g.report_count DESC,
    similarity(g.name, p.term) DESC,
    g.name ASC
  LIMIT (SELECT lim FROM params);
$$;

COMMENT ON FUNCTION public.search_games(text, integer) IS
  'Type-ahead game search: exact > whole-word prefix > prefix > word prefix > report_count > trigram similarity > name. Wildcards escaped; max 50 rows.';

REVOKE ALL ON FUNCTION public.search_games(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_games(text, integer) TO anon, authenticated, service_role;
