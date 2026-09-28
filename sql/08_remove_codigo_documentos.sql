-- ============================================================
-- SGA | 08_remove_codigo_documentos.sql
-- Remove a coluna "codigo" (Código / Referência) de
-- public.documentos - campo descontinuado na tela de cadastro.
--
-- Seguranca: nenhuma policy, RPC, trigger ou index depende dessa
-- coluna (verificado em 01..07 e nas buscas do front-end).
-- Eventos ja gravados na auditoria mantem o jsonb antigo (historico).
--
-- ⚠️ ORDEM: publique o FRONT-END ANTES de executar este script.
--    O front novo ja nao referencia a coluna; se rodar este SQL
--    primeiro, a tela de pesquisa quebra com o front antigo no ar.
--    (O inverso nao quebra nada: front novo + coluna antiga = OK.)
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: 01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 1 - Remove a coluna
-- (index e constraints dependentes sao removidos junto)
-- ------------------------------------------------------------
ALTER TABLE public.documentos DROP COLUMN IF EXISTS codigo;

-- ------------------------------------------------------------
-- VERIFICACAO FINAL
-- ------------------------------------------------------------
-- a) coluna ja nao existe (esperado: ZERO linhas)
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'documentos'
   AND column_name = 'codigo';

-- b) nenhuma policy de documentos citando "codigo"
--    (esperado: ZERO linhas)
SELECT policyname, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'documentos'
   AND (COALESCE(qual, '') ILIKE '%codigo%'
        OR COALESCE(with_check, '') ILIKE '%codigo%');
