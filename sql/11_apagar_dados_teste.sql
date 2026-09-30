-- ============================================================
-- SGA | 11_apagar_dados_teste.sql
-- APAGA OS DADOS DE TESTE (irreversivel!).
--
-- O que apaga:
--   arquivos_digitais, emprestimos, documentos, caixas,
--   prateleiras, estantes, corredores, salas, auditoria
--   e a sequencia de protocolo (volta a AAAA-000001).
--
-- O que mantem:
--   usuarios (login e perfis), auth.users e a estrutura
--   das tabelas (nenhuma DROP TABLE / ALTER; colunas como
--   capacidade e corredor_id permanecem).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Reexecutavel: rodar de novo nao apaga nada (ja estara vazio).
--
-- ⚠️ ANTES DE RODAR: faca backup se precisar dos dados
--    (Supabase > Database > Backups, ou pg_dump).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Conferencia do que existe HOJE
-- ------------------------------------------------------------
SELECT 'arquivos_digitais' AS tabela, count(*) FROM public.arquivos_digitais
UNION ALL SELECT 'emprestimos',      count(*) FROM public.emprestimos
UNION ALL SELECT 'documentos',       count(*) FROM public.documentos
UNION ALL SELECT 'caixas',           count(*) FROM public.caixas
UNION ALL SELECT 'prateleiras',      count(*) FROM public.prateleiras
UNION ALL SELECT 'estantes',         count(*) FROM public.estantes
UNION ALL SELECT 'corredores',       count(*) FROM public.corredores
UNION ALL SELECT 'salas',            count(*) FROM public.salas
UNION ALL SELECT 'auditoria',        count(*) FROM public.auditoria
UNION ALL SELECT 'usuarios',         count(*) FROM public.usuarios
ORDER BY tabela;

-- ------------------------------------------------------------
-- 2) Exclusao na ordem das dependencias (filhos antes dos pais)
--    A auditoria vai por ULTIMO: cada DELETE acima dispara o
--    trigger trg_auditoria e criaria registros novos.
--    usuarios NAO entra na lista (mantidos).
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arquivos_digitais', 'emprestimos', 'documentos', 'caixas',
    'prateleiras', 'estantes', 'corredores', 'salas',
    'auditoria'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;
    EXECUTE format('DELETE FROM public.%I', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3) Zera as sequencias (protocolo volta a AAAA-000001 e os
--    codigos das localizacoes voltam ao inicio: SL-001, C-001,
--    E-001, P-0001, CX-000001)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.protocolo_sequencia') IS NOT NULL THEN
    DELETE FROM public.protocolo_sequencia;
  END IF;
  IF to_regclass('public.codigo_sequencia') IS NOT NULL THEN
    DELETE FROM public.codigo_sequencia;
  END IF;
END $$;

COMMIT;

-- ------------------------------------------------------------
-- VERIFICACAO FINAL
--    Esperado: 0 em todas, EXCETO usuarios (mantidos).
-- ------------------------------------------------------------
SELECT 'arquivos_digitais' AS tabela, count(*) FROM public.arquivos_digitais
UNION ALL SELECT 'emprestimos',      count(*) FROM public.emprestimos
UNION ALL SELECT 'documentos',       count(*) FROM public.documentos
UNION ALL SELECT 'caixas',           count(*) FROM public.caixas
UNION ALL SELECT 'prateleiras',      count(*) FROM public.prateleiras
UNION ALL SELECT 'estantes',         count(*) FROM public.estantes
UNION ALL SELECT 'corredores',       count(*) FROM public.corredores
UNION ALL SELECT 'salas',            count(*) FROM public.salas
UNION ALL SELECT 'auditoria',        count(*) FROM public.auditoria
UNION ALL SELECT 'usuarios',         count(*) FROM public.usuarios
ORDER BY tabela;

-- Protocolo esperado apos o reset:
-- SELECT public.proximo_protocolo();
