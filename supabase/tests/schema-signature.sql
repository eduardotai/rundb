-- Read-only catalog signature of the app schema (no table data): one sorted line per column,
-- constraint, index, RLS flag, policy, function (body md5 + config), grant, trigger, enum and
-- extension. Diff the output of two databases to detect drift, e.g. local migrations vs production:
--   psql "$DB_URL" -X -tA -f supabase/tests/schema-signature.sql > sig.txt
WITH s AS (SELECT unnest(ARRAY['public','private']) AS nsp),
lines AS (
  SELECT 'ext' AS k, e.extname || ' @' || n.nspname AS l FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
    WHERE e.extname IN ('pg_trgm','pgcrypto','uuid-ossp')
  UNION ALL
  SELECT 'enum', t.typname || ' = ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' GROUP BY t.typname
  UNION ALL
  SELECT 'col', c.relname || '.' || lpad((row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum))::text,2,'0') || ' ' || a.attname || ' ' || format_type(a.atttypid,a.atttypmod)
      || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
      || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'con', c.conrelid::regclass::text || ' ' || c.conname || ' ' || c.contype::text || ' ' || pg_get_constraintdef(c.oid)
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype IN ('p','u','f','c')
  UNION ALL
  SELECT 'idx', i.tablename || ' ' || regexp_replace(i.indexdef, ' ON public\.| ON ', ' ON ')
    FROM pg_indexes i WHERE i.schemaname='public'
  UNION ALL
  SELECT 'rls', c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
  UNION ALL
  SELECT 'pol', p.tablename || ' "' || p.policyname || '" ' || p.cmd || ' ' || p.permissive || ' to=' || array_to_string(p.roles, ',')
      || ' using=' || COALESCE(p.qual,'-') || ' check=' || COALESCE(p.with_check,'-')
    FROM pg_policies p WHERE p.schemaname='public'
  UNION ALL
  SELECT 'fn', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> ' || pg_get_function_result(p.oid)
      || ' secdef=' || p.prosecdef || ' vol=' || p.provolatile::text || ' cfg=' || COALESCE(array_to_string(p.proconfig, ';'),'-')
      || ' src_md5=' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN (SELECT nsp FROM s) AND p.prokind='f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.objid=p.oid AND dp.deptype='e')
  UNION ALL
  SELECT 'fnacl', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
      || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN (SELECT nsp FROM s) AND p.prokind='f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend dp WHERE dp.objid=p.oid AND dp.deptype='e')
  UNION ALL
  SELECT 'trg', c.relnamespace::regnamespace::text || '.' || c.relname || ' ' || regexp_replace(pg_get_triggerdef(t.oid), ' ON public\.| ON ', ' ON ')
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE NOT t.tgisinternal AND (c.relnamespace='public'::regnamespace OR (c.relnamespace::regnamespace::text='auth' AND c.relname='users' AND t.tgname='on_auth_user_created'))
  UNION ALL
  SELECT 'grant', g.table_name || ' ' || g.grantee || ' ' || string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
    FROM information_schema.role_table_grants g
    WHERE g.table_schema='public' AND g.grantee IN ('anon','authenticated','service_role') GROUP BY g.table_name, g.grantee
  UNION ALL
  SELECT 'comment', c.relname || '.' || a.attname || ' ' || md5(col_description(c.oid, a.attnum))
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    WHERE c.relnamespace='public'::regnamespace AND col_description(c.oid, a.attnum) IS NOT NULL
)
SELECT k || ' | ' || l AS line FROM lines ORDER BY k, l;
