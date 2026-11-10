-- search_games(q, max_results): game name search ranked for a type-ahead box.
--
-- The client used `games.name ILIKE '%q%' ORDER BY name LIMIT n`, so in a 10k-game catalog
-- "cyber" listed "A-Tech Cybernetic VR", "Bomb Rush Cyberfunk", ... before Cyberpunk 2077
-- (8th). This ranks exact name, then name prefix, then word prefix, then games with more
-- approved reports, then trigram similarity, then name.
--
-- LIKE wildcards in the input (\ % _) are escaped, so "100%" searches for a literal "100%".
-- The ILIKE '%term%' predicate uses idx_games_name_trgm (gin_trgm_ops) from the baseline.
--
-- SECURITY INVOKER: it reads public.games with the caller's privileges and RLS (games are
-- public-read). Backward compatible: new function only; nothing else changes.

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
    lower(g.name) LIKE p.esc || '%' DESC,
    position(' ' || p.term IN ' ' || lower(g.name)) > 0 DESC,
    g.report_count DESC,
    similarity(g.name, p.term) DESC,
    g.name ASC
  LIMIT (SELECT lim FROM params);
$$;

COMMENT ON FUNCTION public.search_games(text, integer) IS
  'Type-ahead game search: exact > prefix > word prefix > report_count > trigram similarity > name. Wildcards escaped; max 50 rows.';

REVOKE ALL ON FUNCTION public.search_games(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_games(text, integer) TO anon, authenticated, service_role;
