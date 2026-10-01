-- ============================================================
-- SGA | 11_apagar_dados_teste.sql
-- APAGA OS DADOS DE TESTE (irreversivel!).
--
-- O que apaga:
--   TODAS as tabelas do schema public - documentos, emprestimos,
--   caixas, prateleiras, estantes, corredores, salas,
--   arquivos_digitais, auditoria, protocolo_sequencia e
--   codigo_sequencia. A lista e montada DINAMICAMENTE na hora
--   de rodar: tabelas novas entram sozinhas, sem editar o script.
--
-- O que mantem:
--   usuarios (cadastro, login e perfis), auth.users (senhas) e a
--   estrutura das tabelas (nenhuma DROP TABLE / ALTER; colunas
--   como capacidade e corredor_id permanecem).
--
-- Ordem das exclusoes:
--   filhos antes dos pais, resolvida pelas proprias FKs em
--   rodadas (DELETE nao precisa de ordem perfeita, so de repetir
--   ate' nenhuma tabela mais avancar). A AUDITORIA vai por
--   ULTIMO: cada DELETE nas tabelas de negocio dispara o
--   trg_auditoria e cria registros novos.
--   Tabelas de extensao (ex.: spatial_ref_sys do PostGIS) sao
--   ignoradas.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Reexecutavel: rodar de novo nao apaga nada (ja estara vazio).
--
-- ⚠️ ANTES DE RODAR: faca backup se precisar dos dados
--    (Supabase > Database > Backups, ou pg_dump).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Conferencia do que existe HOJE (menos usuarios)
-- ------------------------------------------------------------
SELECT 'public.' || c.relname AS tabela,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint AS linhas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND c.relname <> 'usuarios'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid
                      AND d.deptype = 'e')
 ORDER BY 1;

-- ------------------------------------------------------------
-- 2) Esvazia todas as tabelas (menos usuarios e auditoria),
--    em rodadas: a cada passo tenta todas as que ainda falharam
--    (FK de filho -> pai), ate' nenhuma avancar.
-- ------------------------------------------------------------
DO $$
DECLARE
  t       text;
  pend    text[];
  prox    text[];
  n_antes int;
  rodada  int := 0;
BEGIN
  SELECT COALESCE(array_agg(c.relname ORDER BY c.relname), '{}')
    INTO pend
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN ('usuarios', 'auditoria')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid
                        AND d.deptype = 'e');

  WHILE COALESCE(array_length(pend, 1), 0) > 0 LOOP
    rodada  := rodada + 1;
    n_antes := array_length(pend, 1);
    prox    := '{}';

    FOREACH t IN ARRAY pend LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I', t);
      EXCEPTION WHEN others THEN
        prox := prox || t;   -- ainda bloqueada: tenta de novo na proxima rodada
      END;
    END LOOP;

    pend := prox;
    EXIT WHEN rodada > 20
           OR COALESCE(array_length(pend, 1), 0) >= n_antes;  -- sem progresso
  END LOOP;

  -- Motivo de cada tabela que sobrou (FK apontando para fora do public?)
  FOREACH t IN ARRAY COALESCE(pend, '{}') LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I', t);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'AVISO: public.% nao foi esvaziada (%)', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3) Auditoria POR ULTIMO: apaga tambem os registros gerados
--    pelos DELETEs acima (o proprio DELETE na auditoria nao tem
--    trigger, entao nao se recria).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.auditoria') IS NOT NULL THEN
    DELETE FROM public.auditoria;
  END IF;
END $$;

COMMIT;

-- ------------------------------------------------------------
-- VERIFICACAO FINAL
--    Esperado: 0 linhas em TODAS as tabelas (menos usuarios).
-- ------------------------------------------------------------
SELECT 'public.' || c.relname AS tabela,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text::bigint AS linhas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p')
   AND c.relname <> 'usuarios'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid
                      AND d.deptype = 'e')
 ORDER BY 1;

-- Usuarios mantidos (esperado: as mesmas linhas de antes)
SELECT id, email, nome, perfil
  FROM public.usuarios
 ORDER BY email;

-- As sequencias (public.protocolo_sequencia e public.codigo_sequencia)
-- aparecem no listado acima com 0 linhas: o protocolo volta a
-- AAAA-000001 e os codigos das localizacoes voltam ao inicio
-- (SL-001, C-001, E-001, P-0001, CX-000001).
