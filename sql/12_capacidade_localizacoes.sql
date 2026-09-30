-- ============================================================
-- SGA | 12_capacidade_localizacoes.sql
-- Campo "Capacidade" nas secoes da tela Cadastro > Salas de Arquivo:
--   Sala/Corredor -> quantidade de Estantes que comporta
--   Estante       -> quantidade de Prateleiras que comporta
--   Prateleira    -> quantidade de Caixas que comporta
--   Caixa (ja existente) -> quantidade de Pastas que comporta
--
-- Coluna nova em 4 tabelas: capacidade (integer, nullable;
-- linhas antigas ficam NULL e o formulario envia 50 por padrao).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 10_corredores.sql.
-- ============================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['salas', 'corredores', 'estantes', 'prateleiras'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS capacidade integer', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- VERIFICACAO FINAL (esperado: capacidade em nas 4 tabelas)
-- ------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND column_name = 'capacidade'
   AND table_name IN ('salas', 'corredores', 'estantes', 'prateleiras', 'caixas')
 ORDER BY table_name;
