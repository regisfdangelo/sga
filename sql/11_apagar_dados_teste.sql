-- ============================================================
-- SGA | 11_apagar_dados_teste.sql
-- APAGA OS DADOS DE TESTE de TODAS as tabelas (irreversivel!).
--
-- O que apaga:
--   TODAS as tabelas do schema public, EXCETO usuarios. A lista
--   e montada DINAMICAMENTE na hora de rodar, entao tabelas novas
--   entram sozinhas, sem editar o script:
--     documentos, emprestimos, salas, corredores, estantes,
--     prateleiras, caixas, auditoria, protocolo_sequencia,
--     codigo_sequencia (inclui as salas geradas pela aba
--     "Gerar Sala de Arquivo" - sql/16) e qualquer outra que
--     existir no public.
--
-- O que mantem:
--   usuarios (cadastro, login e perfis), auth.users (senhas) e a
--   estrutura das tabelas (nenhuma DROP TABLE / ALTER; colunas
--   como capacidade e corredor_id permanecem). Existe ainda uma
--   trava dupla no script: a lista de exclusao NUNCA contem
--   usuarios e o script aborta se ela aparecer.
--
-- Como apaga:
--   1) TRUNCATE de uma vez - rapido, nao dispara o trigger de
--      auditoria (que recriaria linha a linha) e zera os
--      contadores de id (RESTART IDENTITY);
--   2) se algum FK de FORA do public bloquear o TRUNCATE, cai
--      para DELETE em rodadas (filho antes do pai, repetindo ate'
--      nenhuma avancar) e a AUDITORIA por ULTIMO, porque cada
--      DELETE nas tabelas de negocio dispara trg_auditoria;
--   3) termina com AVISO (RAISE WARNING) se alguma tabela ainda
--      tiver linhas - dado sobrando nunca passa em silencio.
--
-- Tabelas de extensao (ex.: spatial_ref_sys do PostGIS) ficam de
-- fora. No caminho de fallback (DELETE) os ids seguem contando;
-- com TRUNCATE eles voltam a 1.
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
   AND c.relkind IN ('r', 'p', 'm')
   AND c.relname <> 'usuarios'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid
                      AND d.deptype = 'e')
 ORDER BY 1;

-- ------------------------------------------------------------
-- 2) Esvazia tudo (menos usuarios e extensoes)
-- ------------------------------------------------------------
DO $$
DECLARE
  lista   text[] := '{}';   -- nomes ja qualificados: public."tabela"
  pend    text[];
  prox    text[];
  t       text;
  n_antes int;
  rodada  int := 0;
BEGIN
  SELECT COALESCE(array_agg(format('public.%I', c.relname) ORDER BY c.relname), '{}')
    INTO lista
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'm')
     AND c.relname <> 'usuarios'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid
                        AND d.deptype = 'e');

  -- TRAVA: usuarios nunca entra na lista de exclusao
  IF 'public.usuarios' = ANY (lista) THEN
    RAISE EXCEPTION 'Interno: usuarios entrou na lista de limpeza. Abortado.';
  END IF;

  IF COALESCE(array_length(lista, 1), 0) = 0 THEN
    RAISE NOTICE 'Nada a apagar (so usuarios/extensoes no schema public).';
    RETURN;
  END IF;

  -- 2a) Caminho rapido: TRUNCATE de uma vez. O TRUNCATE sem
  --     CASCADE so funciona se TODAS as tabelas referenciadas por
  --     FK estiverem na lista - estao: so usuarios fica de fora e
  --     nenhuma tabela referencia usuarios como pai.
  BEGIN
    EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY', array_to_string(lista, ', '));
    RAISE NOTICE 'TRUNCATE concluido: % tabela(s) esvaziada(s).', array_length(lista, 1);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'TRUNCATE nao foi possivel (%), apagando em rodadas...', SQLERRM;

    -- 2b) Fallback: DELETE em rodadas (FK filho -> pai). A cada
    --     rodada tenta todas as que ainda falharam, ate' nenhuma
    --     avancar ou estourar 20 rodadas.
    SELECT COALESCE(array_agg(format('public.%I', c.relname) ORDER BY c.relname), '{}')
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
          EXECUTE format('DELETE FROM %s', t);
        EXCEPTION WHEN others THEN
          prox := prox || t;   -- ainda bloqueada: tenta de novo na proxima rodada
        END;
      END LOOP;

      pend := prox;
      EXIT WHEN rodada > 20
             OR COALESCE(array_length(pend, 1), 0) >= n_antes;  -- sem progresso
    END LOOP;

    -- Auditoria POR ULTIMO: os DELETEs acima dispara o
    -- trg_auditoria e recria registro; este DELETE final limpa
    -- tambem os gerados durante a rodada.
    IF to_regclass('public.auditoria') IS NOT NULL THEN
      DELETE FROM public.auditoria;
    END IF;
  END;
END $$;

-- ------------------------------------------------------------
-- 3) Confere linha a linha: AVISA se sobrou algo. Nada de
--    terminar "ok" com dado esquecido numa tabela.
-- ------------------------------------------------------------
DO $$
DECLARE
  tab   record;
  n_lin bigint;
  resto int := 0;
BEGIN
  FOR tab IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'm')
       AND c.relname <> 'usuarios'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_class'::regclass
                          AND d.objid = c.oid
                          AND d.deptype = 'e')
     ORDER BY c.relname
  LOOP
    SELECT (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tab.relname), false, true, '')))[1]::text::bigint
      INTO n_lin;
    IF COALESCE(n_lin, 0) > 0 THEN
      resto := resto + 1;
      RAISE WARNING 'public.% continua com % linha(s): nao foi possivel apagar.', tab.relname, n_lin;
    END IF;
  END LOOP;

  IF resto = 0 THEN
    RAISE NOTICE 'Limpeza concluida: todas as tabelas do public (menos usuarios) zeradas.';
  ELSE
    RAISE WARNING 'Limpeza INCOMPLETA: % tabela(s) ainda com dados (ver avisos acima).', resto;
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
   AND c.relkind IN ('r', 'p', 'm')
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
