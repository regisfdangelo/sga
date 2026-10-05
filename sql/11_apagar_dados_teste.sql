-- ============================================================
-- SGA | 11_apagar_dados_teste.sql
-- ZERA TODAS as tabelas do sistema, menos usuarios (irreversivel!).
--
-- O que apaga:
--   TODAS as tabelas do schema public, EXCETO usuarios. A lista
--   e montada DINAMICAMENTE na hora de rodar, entao tabelas novas
--   entram sozinhas, sem editar o script. Com o codigo atual
--   (assets/js/api.js + assets/js/app.js) as tabelas de negocio
--   sao estas:
--     documentos, emprestimos, salas, corredores, estantes,
--     prateleiras, caixas, arquivos_digitais, auditoria,
--     protocolo_sequencia, codigo_sequencia
--   (as salas geradas pela aba "Gerar Sala de Arquivo" - sql/17 -
--   entram sozinhas como linhas em salas/corredores/estantes/
--   prateleiras/caixas).
--
-- O que mantem:
--   usuarios (cadastro, login e perfis) e TODA a estrutura: o
--   script nao faz DROP TABLE nem ALTER COLUMN, entao colunas
--   como documentos.descartado_em (sql/19), capacidade das
--   caixas (sql/12), corredor_id (sql/10) e as colunas de sala
--   linha/coluna (sql/17) continuam existindo.
--   Tabelas de extensao (ex.: spatial_ref_sys do PostGIS) tambem
--   ficam de fora, por pertencerem a uma extension.
--
-- ⚠️ ESTE APAGA TAMBEM O HISTORICO DE auditoria
--   Some o historico de LOGIN/LOGOUT e todos os registros
--   INSERT/UPDATE/DELETE e DESCARTE (acao do sql/19). Se voce
--   precisa preservar o log de "quem descartou o quê", tire
--   'auditoria' da lista de exclusao antes de rodar.
--
-- ⚠️ NAO TOCA em outros schemas
--   auth.users (as senhas), storage e demais schemas ficam
--   intactos: o script so enxerga n.nspname = 'public'.
--
-- Como apaga:
--   1) TRUNCATE de uma vez - rapido, nao dispara o trigger de
--      auditoria (que recriaria linha a linha) e zera os
--      contadores de id (RESTART IDENTITY);
--   2) sequencias soltas do public que NAO sao de identity col
--      (relkind 'S', fora do TRUNCATE) vao para o inicio com
--      ALTER SEQUENCE ... RESTART - e o script avisa quantas
--      eram, porque nenhuma existe hoje;
--   3) se algum FK de FORA do public bloquear o TRUNCATE, cai
--      para DELETE em rodadas (filho antes do pai, repetindo ate'
--      nenhuma avancar) e a AUDITORIA por ULTIMO, porque cada
--      DELETE nas tabelas de negocio dispara trg_auditoria;
--   4) os CONTADORES de protocolo e codigo (protocolo_sequencia
--      e codigo_sequencia sao TABELAS, nao sequences) vao a zero.
--      Isso e seguro: gerar_protocolo (sql/09) e gerar_codigo
--      (sql/13/14) recriam a linha da chave com
--      INSERT ... ON CONFLICT / IF NOT EXISTS quando nao a
--      acham, e como documentos/salas/etc. tambem ficam vazios
--      o max() de partida e 0. Entao o protocolo volta a
--      AAAA-000001 e os codigos ao inicio (SL-001, C-001,
--      E-001, P-0001, CX-000001).
--   5) termina com AVISO (RAISE WARNING) se alguma tabela ainda
--      tiver linhas - dado sobrando nunca passa em silencio - e
--      ABORTA se a contagem de usuarios mudar (a garantia de que
--      o cadastro foi preservado deixa de ser so comentario).
--
-- Se o script ABORTAR, NADA foi apagado: o RAISE EXCEPTION quebra
-- o BEGIN/COMMIT e o Postgres desfaz a transacao inteira. E o que
-- se quer: se o cadastro de usuarios mudar junto com a limpeza, o
-- script prefere falhar e devolver tudo a receber um banco
-- apagado pela metade. O motivo da falha aparece em "Database >
-- Logs" ou na mensagem de erro do SQL Editor.
--
-- Ordem de execucao: independe de onde os outros scripts pararam.
-- Rodar antes ou depois do sql/19 nao muda o resultado (o
-- descarte e so dado; a coluna e estrutura permanecem).
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
  seq     record;
  n_seq   int := 0;
  n_antes int;
  rodada  int := 0;
  n_usuarios_antes bigint;
  n_usuarios_depois bigint;
BEGIN
  -- Quantos usuarios existem ANTES: a garantia de preservacao e
  -- conferida no fim, nao só afirmada em comentario.
  IF to_regclass('public.usuarios') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.usuarios' INTO n_usuarios_antes;
  ELSE
    n_usuarios_antes := 0;
  END IF;

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

  -- TRAVA: usuarios nunca entra na lista de limpeza
  IF 'public.usuarios' = ANY (lista) THEN
    RAISE EXCEPTION 'Interno: usuarios entrou na lista de limpeza. Abortado.';
  END IF;

  -- 2a) Sequencias SOLTAS do public (relkind 'S'). O TRUNCATE ...
  --     RESTART IDENTITY so mexe nas sequences que pertencem a uma
  --     tabela truncada; uma CREATE SEQUENCE avulsa ficaria com o
  --     contador parado, entao e zerada aqui. Hoje nao existe
  --     nenhuma - o aviso existe para o dia em que existir.
  FOR seq IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relname NOT LIKE 'pg\\_%'
  LOOP
    n_seq := n_seq + 1;
  END LOOP;

  -- 2b) Caminho rapido: TRUNCATE de uma vez. O TRUNCATE sem
  --     CASCADE so funciona se TODAS as tabelas referenciadas por
  --     FK estiverem na lista - so usuarios fica de fora e nenhuma
  --     tabela do public referencia usuarios como pai (o
  --     auditoria.usuario_id e uuid SEM FK, ver sql/02).
  --
  --     Se nao houver NENHUMA tabela, nao se faz o IF: as etapas
  --     2d (reiniciar sequences soltas) e 2e (conferir usuarios)
  --     ainda precisam rodar. Um RETURN aqui pularia as duas.
  IF COALESCE(array_length(lista, 1), 0) > 0 THEN
    BEGIN
      EXECUTE format('TRUNCATE TABLE %s RESTART IDENTITY', array_to_string(lista, ', '));
      RAISE NOTICE 'TRUNCATE concluido: % tabela(s) esvaziada(s).', array_length(lista, 1);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'TRUNCATE nao foi possivel (%), apagando em rodadas...', SQLERRM;

      -- 2c) Fallback: DELETE em rodadas (FK filho -> pai). A cada
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

      -- Auditoria POR ULTIMO: os DELETEs acima disparo o
      -- trg_auditoria e recria registro; este DELETE final limpa
      -- tambem os gerados durante a rodada.
      IF to_regclass('public.auditoria') IS NOT NULL THEN
        DELETE FROM public.auditoria;
      END IF;
    END;
  ELSE
    RAISE NOTICE 'Nenhuma tabela de dados no public: so ha usuarios e/ou tabelas de extensao.';
  END IF;

  -- 2d) Zera as sequences soltas do public (fora do TRUNCATE).
  --     No caminho DELETE os ids de identity col seguem contando:
  --     e o RESTART que devolve o contador ao inicio.
  FOR seq IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relname NOT LIKE 'pg\\_%'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I RESTART', seq.relname);
  END LOOP;

  IF n_seq > 0 THEN
    RAISE NOTICE '% sequence(s) solta(s) do public foram reiniciadas.', n_seq;
  ELSE
    RAISE NOTICE 'Nenhuma sequence solta no public (contadores sao identity col ou tabelas de sequencia).';
  END IF;

  -- 2e) usuarios intactos?
  IF to_regclass('public.usuarios') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.usuarios' INTO n_usuarios_depois;
  ELSE
    n_usuarios_depois := 0;
  END IF;

  IF n_usuarios_depois <> n_usuarios_antes THEN
    RAISE EXCEPTION
      'A quantidade de usuarios mudou (antes %, agora %). O cadastro deveria ter ficado intacto: revise.',
      n_usuarios_antes, n_usuarios_depois;
  END IF;

  RAISE NOTICE 'usuarios preservados: % linha(s).', n_usuarios_depois;
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

-- Os contadores de protocolo e codigo aparecem com 0 linhas no
-- listado acima: a proxima geracao recria a chave (INSERT ... ON
-- CONFLICT em sql/09 e IF NOT EXISTS em sql/13/14) e parte do
-- max() = 0, entao protocolo = AAAA-000001 e codigos = SL-001,
-- C-001, E-001, P-0001, CX-000001.
