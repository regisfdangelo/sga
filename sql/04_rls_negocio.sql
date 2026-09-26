-- ============================================================
-- SGA | 04_rls_negocio.sql
-- Espelho do estado REAL das politicas RLS das tabelas de
-- negocio, verificado em 26/09/2026 via pg_policies/role_table_grants.
--
-- Estado confirmado:
--   * RLS ativo (relrowsecurity = true) nas 9 tabelas de public
--   * anon sem NENHUM grant em public
--   * 4 politicas (select/insert/update/delete) TO authenticated
--     com USING/WITH CHECK = true nas tabelas de negocio
--   * usuarios e auditoria ficam com as politicas de 01/02 (nao mexer)
--
-- Observacao: as policies se chamam "documentos_*" em todas as
-- tabelas (nomes copiados do original) - mantidos aqui para
-- espelhar exatamente o banco. Renomear e' apenas cosmético.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: 01_perfis.sql -> 02_auditoria.sql -> 03_usuarios_rpc.sql -> 04_rls_negocio.sql
-- ============================================================

DO $$
DECLARE
  t TEXT;
  p RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arquivos_digitais', 'caixas', 'documentos', 'emprestimos',
    'estantes', 'prateleiras', 'salas'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;

    -- 1) RLS sempre ativo (defesa contra GRANTs acidentais futuros)
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 2) Recria as politicas (remove as existentes antes)
    FOR p IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('CREATE POLICY documentos_select ON public.%I '
                   || 'FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY documentos_insert ON public.%I '
                   || 'FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY documentos_update ON public.%I '
                   || 'FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY documentos_delete ON public.%I '
                   || 'FOR DELETE TO authenticated USING (true)', t);

    -- 3) A anon key e' publica: anon NUNCA toca nas tabelas
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    -- 4) Higiene: TRUNCATE nao e' coberto por RLS nem exposto pelo
    --    PostgREST, mas nao precisa ficar disponivel para authenticated
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM authenticated', t);
  END LOOP;

  RAISE NOTICE 'RLS das tabelas de negocio reforçado.';
END $$;

-- ------------------------------------------------------------
-- VERIFICACAO FINAL
-- ------------------------------------------------------------
-- a) Policies (esperado: apenas "documentos_*" TO authenticated
--    nas 7 tabelas de negocio + usuarios/auditoria de 01/02)
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname;

-- b) Grants do anon (esperado: ZERO linhas)
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
 ORDER BY table_name;

-- c) RLS ativo (esperado: true em todas)
SELECT c.relname AS tabela, c.relrowsecurity AS rls
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
 ORDER BY c.relname;
