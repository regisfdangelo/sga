-- ============================================================
-- SGA | 14_codigos_escopo_localizacoes.sql
-- Codigo automatico COM ESCOPO na tela Cadastro > Salas de Arquivo:
--
--   Corredor: sequencia POR SALA
--     Sala A: C-001, C-002, C-003 ...   Sala B: C-001, C-002 ...
--   Estante:  sequencia POR SALA + CORREDOR
--     Sala A / Corredor 1: E-001, E-002 ...
--     Sala A / Corredor 2: E-001, E-002 ...
--   Prateleira: sequencia POR SALA + CORREDOR + ESTANTE
--     (a prateleira guarda so o estante, e o estante ja pertence
--      a UMA sala e UM corredor; logo o escopo "sala + corredor +
--      estante" do formulario = o estante escolhido)
--     Sala A / Corr 1 / Estante 1: P-0001, P-0002 ...
--     Sala A / Corr 1 / Estante 2: P-0001, P-0002 ...
--   Caixa: sequencia POR SALA + CORREDOR + ESTANTE + PRATELEIRA
--     (a caixa guarda a prateleira, e a prateleira ja pertence a
--      uma estante, um corredor e uma sala; logo o escopo
--      "sala + corredor + estante + prateleira" do formulario =
--      a prateleira escolhida)
--     Sala A / Corr 1 / Est 1 / Prat 1: CX-000001, CX-000002 ...
--     Sala A / Corr 1 / Est 1 / Prat 2: CX-000001, CX-000002 ...
--   Sala continua com sequencia unica/global (SL-001).
--
-- O que muda:
--   1) gerar_codigo / proximo_codigo aceitam o 2o parametro
--      p_escopo (opcional), com os valores NA ORDEM das colunas
--      do escopo, separados por "|":
--        corredores  -> "<sala_id>"
--        estantes    -> "<sala_id>|<corredor_id>"
--        prateleiras -> "<estante_id>"
--        caixas      -> "<prateleira_id>"
--      Para corredores, estantes, prateleiras e caixas o escopo
--      e OBRIGATORIO.
--   2) A unicidade deixa de ser global:
--        corredores  -> (sala_id, codigo)
--        estantes    -> (sala_id, corredor_id, codigo)
--        prateleiras -> (estante_id, codigo)
--        caixas      -> (prateleira_id, codigo)
--      Assim o mesmo C-001 / E-001 / P-0001 / CX-000001 pode
--      existir em outra sala, corredor, estante ou prateleira.
--      Estantes antigas sem corredor_id nao conflitam (NULL nao
--      choca no indice unico).
--      Para isso sao removidos os travamentos globais de
--      codigo: as constraints UNIQUE (codigo) ja existentes na
--      tabela (ex.: estantes_codigo_key) e os indices
--      *_codigo_unico criados pelo 13.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 13_codigos_automaticos.sql.
--
-- Atualizacao da 1a versao (so tinha o escopo do corredor):
-- rodar este arquivo de novo substitui as funcoes - nao tem
-- problema, o formato da chave (chave:escopo) nao muda.
--
-- Revisao: escopo da PRATELEIRA (por sala + corredor + estante)
-- e da CAIXA (por sala + corredor + estante + prateleira).
-- Rode este arquivo de novo para as funcoes, os indices unicos
-- (estante_id, codigo) e (prateleira_id, codigo) e a limpeza dos
-- contadores orfaos.
--
-- Atencao: se voltar a rodar o 13_codigos_automaticos.sql, rode
--          este 14 em seguida (o 13 recria as funcoes antigas,
--          sem o p_escopo).
-- ============================================================

-- ------------------------------------------------------------
-- 1) funcoes com p_escopo (as versoes sem escopo saem no passo 2)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_codigo(p_chave text, p_escopo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefixo   text;
  v_digitos   int;
  v_tabela    text;
  v_colunas   text[] := NULL;   -- colunas do escopo, na ordem de p_escopo
  v_chave_seq text;             -- chave em codigo_sequencia (corredores:<sala>)
  v_filtro    text := '';       -- WHERE do calculo do maximo inicial
  v_vals      text[];
  v_max       bigint;
  v_ultimo    bigint;
  v_num       text;
  i           int;
BEGIN
  CASE p_chave
    WHEN 'salas'       THEN v_prefixo := 'SL'; v_digitos := 3; v_tabela := 'salas';
    WHEN 'corredores'  THEN v_prefixo := 'C';  v_digitos := 3; v_tabela := 'corredores';
                           v_colunas := ARRAY['sala_id'];
    WHEN 'estantes'    THEN v_prefixo := 'E';  v_digitos := 3; v_tabela := 'estantes';
                           v_colunas := ARRAY['sala_id', 'corredor_id'];
    WHEN 'prateleiras' THEN v_prefixo := 'P';  v_digitos := 4; v_tabela := 'prateleiras';
                           v_colunas := ARRAY['estante_id'];
    WHEN 'caixas'      THEN v_prefixo := 'CX'; v_digitos := 6; v_tabela := 'caixas';
                           v_colunas := ARRAY['prateleira_id'];
    ELSE RAISE EXCEPTION 'Chave de codigo desconhecida: %', p_chave;
  END CASE;

  IF v_colunas IS NOT NULL THEN
    IF p_escopo IS NULL OR btrim(p_escopo) = '' THEN
      RAISE EXCEPTION 'Esta chave exige o escopo (valores separados por |) em p_escopo.'
        USING DETAIL = 'chave=' || COALESCE(p_chave, '(nula)');
    END IF;

    v_vals := string_to_array(p_escopo, '|');
    IF cardinality(v_vals) <> cardinality(v_colunas) THEN
      RAISE EXCEPTION 'Escopo invalido para esta chave.'
        USING DETAIL = format('esperado %s valor(es): %s | informado: %s',
                              cardinality(v_colunas),
                              array_to_string(v_colunas, ' | '), p_escopo);
    END IF;
    IF '' = ANY (v_vals) THEN
      RAISE EXCEPTION 'Escopo com valor vazio.'
        USING DETAIL = 'chave=' || p_chave || ' | escopo=' || p_escopo;
    END IF;

    -- chave da sequencia = chave + escopo inteiro (ex.:
    -- estantes:<sala>|<corredor>) -> cada sala/corredor tem o seu
    -- contador e a trava advisory e por eles tambem.
    v_chave_seq := p_chave || ':' || p_escopo;

    -- id de sala pode ser uuid ou bigint: a comparacao via ::text
    -- funciona nos dois tipos (mesmo formato que o front envia)
    FOR i IN 1 .. cardinality(v_colunas) LOOP
      v_filtro := v_filtro || format(' %s %I::text = %L',
                   CASE WHEN i = 1 THEN 'WHERE' ELSE 'AND' END,
                   v_colunas[i], v_vals[i]);
    END LOOP;
  ELSE
    IF p_escopo IS NOT NULL AND btrim(p_escopo) <> '' THEN
      RAISE EXCEPTION 'Esta chave nao usa escopo; envie p_escopo nulo.'
        USING DETAIL = 'chave=' || p_chave;
    END IF;
    v_chave_seq := p_chave;
  END IF;

  -- trava por chave+escopo (liberada no commit/rollback): sem
  -- corrida, e duas salas/corredores diferentes nao se bloqueiam
  PERFORM pg_advisory_xact_lock(870111, hashtext(v_chave_seq));

  -- primeira uso da chave: parte do maior numero ja existente
  -- no proprio escopo (no estante: o maior codigo daquela sala
  -- naquele corredor)
  IF NOT EXISTS (SELECT 1 FROM public.codigo_sequencia WHERE chave = v_chave_seq) THEN
    EXECUTE format(
      'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I%s',
      v_tabela, v_filtro) INTO v_max;
    INSERT INTO public.codigo_sequencia (chave, ultimo) VALUES (v_chave_seq, COALESCE(v_max, 0));
  END IF;

  UPDATE public.codigo_sequencia
     SET ultimo = ultimo + 1
   WHERE chave = v_chave_seq
  RETURNING ultimo INTO v_ultimo;

  v_num := CASE WHEN length(v_ultimo::text) >= v_digitos
                THEN v_ultimo::text
                ELSE lpad(v_ultimo::text, v_digitos, '0') END;
  RETURN format('%s-%s', v_prefixo, v_num);
END;
$$;

CREATE OR REPLACE FUNCTION public.proximo_codigo(p_chave text, p_escopo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefixo   text;
  v_digitos   int;
  v_tabela    text;
  v_colunas   text[] := NULL;
  v_chave_seq text;
  v_filtro    text := '';
  v_vals      text[];
  v_max       bigint;
  v_seq       bigint;
  v_ultimo    bigint;
  v_num       text;
  i           int;
BEGIN
  CASE p_chave
    WHEN 'salas'       THEN v_prefixo := 'SL'; v_digitos := 3; v_tabela := 'salas';
    WHEN 'corredores'  THEN v_prefixo := 'C';  v_digitos := 3; v_tabela := 'corredores';
                           v_colunas := ARRAY['sala_id'];
    WHEN 'estantes'    THEN v_prefixo := 'E';  v_digitos := 3; v_tabela := 'estantes';
                           v_colunas := ARRAY['sala_id', 'corredor_id'];
    WHEN 'prateleiras' THEN v_prefixo := 'P';  v_digitos := 4; v_tabela := 'prateleiras';
                           v_colunas := ARRAY['estante_id'];
    WHEN 'caixas'      THEN v_prefixo := 'CX'; v_digitos := 6; v_tabela := 'caixas';
                           v_colunas := ARRAY['prateleira_id'];
    ELSE RAISE EXCEPTION 'Chave de codigo desconhecida: %', p_chave;
  END CASE;

  IF v_colunas IS NOT NULL THEN
    IF p_escopo IS NULL OR btrim(p_escopo) = '' THEN
      RAISE EXCEPTION 'Esta chave exige o escopo (valores separados por |) em p_escopo.'
        USING DETAIL = 'chave=' || COALESCE(p_chave, '(nula)');
    END IF;

    v_vals := string_to_array(p_escopo, '|');
    IF cardinality(v_vals) <> cardinality(v_colunas) THEN
      RAISE EXCEPTION 'Escopo invalido para esta chave.'
        USING DETAIL = format('esperado %s valor(es): %s | informado: %s',
                              cardinality(v_colunas),
                              array_to_string(v_colunas, ' | '), p_escopo);
    END IF;
    IF '' = ANY (v_vals) THEN
      RAISE EXCEPTION 'Escopo com valor vazio.'
        USING DETAIL = 'chave=' || p_chave || ' | escopo=' || p_escopo;
    END IF;

    v_chave_seq := p_chave || ':' || p_escopo;

    FOR i IN 1 .. cardinality(v_colunas) LOOP
      v_filtro := v_filtro || format(' %s %I::text = %L',
                   CASE WHEN i = 1 THEN 'WHERE' ELSE 'AND' END,
                   v_colunas[i], v_vals[i]);
    END LOOP;
  ELSE
    IF p_escopo IS NOT NULL AND btrim(p_escopo) <> '' THEN
      RAISE EXCEPTION 'Esta chave nao usa escopo; envie p_escopo nulo.'
        USING DETAIL = 'chave=' || p_chave;
    END IF;
    v_chave_seq := p_chave;
  END IF;

  EXECUTE format(
    'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I%s',
    v_tabela, v_filtro) INTO v_max;

  SELECT COALESCE(MAX(ultimo), 0) INTO v_seq
    FROM public.codigo_sequencia
   WHERE chave = v_chave_seq;

  v_ultimo := GREATEST(COALESCE(v_seq, 0), COALESCE(v_max, 0)) + 1;

  v_num := CASE WHEN length(v_ultimo::text) >= v_digitos
                THEN v_ultimo::text
                ELSE lpad(v_ultimo::text, v_digitos, '0') END;
  RETURN format('%s-%s', v_prefixo, v_num);
END;
$$;

-- ------------------------------------------------------------
-- 2) Remove as versoes antigas SEM escopo.
--    Sem isso, o PostgREST teria duas funcoes com o mesmo nome
--    e passaria a reclamar de ambiguidade nas chamadas.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.gerar_codigo(text);
DROP FUNCTION IF EXISTS public.proximo_codigo(text);

-- ------------------------------------------------------------
-- 3) Unicidade por escopo: primeiro saem TODOS os travamentos
--    GLOBAIS de codigo das tabelas localizadas:
--      a) constraints UNIQUE (codigo) que ja existiam na criacao
--         da tabela (ex.: estantes_codigo_key) - o indice que elas
--         criam NAO pode ser removido com DROP INDEX, precisa do
--         ALTER TABLE ... DROP CONSTRAINT;
--      b) os indices *_codigo_unico criados pelo 13.
--    Depois entra o indice unico por escopo.
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  c RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['corredores', 'estantes', 'prateleiras', 'caixas'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;

    -- a) constraints UNIQUE so de "codigo" (qualquer o nome)
    FOR c IN
      SELECT con.conname
        FROM pg_constraint con
       WHERE con.conrelid = format('public.%I', t)::regclass
         AND con.contype = 'u'
         AND pg_get_constraintdef(con.oid) ~* 'UNIQUE\s*\(\s*codigo\s*\)'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c.conname);
      RAISE NOTICE 'Constraint unica de codigo removida: public.% (%)', t, c.conname;
    END LOOP;

    -- b) indice unico legado do 13
    EXECUTE format('DROP INDEX IF EXISTS public.%I', t || '_codigo_unico');
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.corredores') IS NOT NULL THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS corredores_sala_codigo_unico'
           || ' ON public.corredores (sala_id, codigo)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Indice corredores (sala_id, codigo) nao criado (codigos repetidos na mesma sala?): %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.estantes') IS NOT NULL THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS estantes_sala_corredor_codigo_unico'
           || ' ON public.estantes (sala_id, corredor_id, codigo)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Indice estantes (sala_id, corredor_id, codigo) nao criado (falta a coluna corredor_id ou ha codigos repetidos?): %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.prateleiras') IS NOT NULL THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS prateleiras_estante_codigo_unico'
           || ' ON public.prateleiras (estante_id, codigo)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Indice prateleiras (estante_id, codigo) nao criado (falta a coluna estante_id ou ha codigos repetidos?): %', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.caixas') IS NOT NULL THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS caixas_prateleira_codigo_unico'
           || ' ON public.caixas (prateleira_id, codigo)';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Indice caixas (prateleira_id, codigo) nao criado (falta a coluna prateleira_id ou ha codigos repetidos?): %', SQLERRM;
    END;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) Permissoes: apenas usuarios autenticados (nao anon)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gerar_codigo(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proximo_codigo(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.gerar_codigo(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.proximo_codigo(text, text) TO authenticated;

-- ------------------------------------------------------------
-- 5) Zera os contadores de escopo que nao tem nenhuma linha.
--    O gerar_codigo RESERVA o numero antes do INSERT: se o
--    cadastro falhar (ex.: a constraint global que este script
--    remove), o numero fica consumido e o proximo codigo pula
--    (a primeira estante sairia E-002 sem existir E-001).
--    Contador orfao -> apagado; na proxima chamada a sequencia
--    volta a partir do maior codigo que existe na propria tabela.
--    Idempotente: contador com dados nunca e tocado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_apagados int := 0;
BEGIN
  IF to_regclass('public.codigo_sequencia') IS NULL
     OR to_regclass('public.estantes') IS NULL
     OR to_regclass('public.corredores') IS NULL
     OR to_regclass('public.prateleiras') IS NULL
     OR to_regclass('public.caixas') IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.codigo_sequencia cs
   WHERE (cs.chave LIKE 'corredores:%'
       OR cs.chave LIKE 'estantes:%'
       OR cs.chave LIKE 'prateleiras:%'
       OR cs.chave LIKE 'caixas:%'
       OR cs.chave IN ('corredores', 'estantes', 'prateleiras', 'caixas'))  -- sequencia global antiga
     AND NOT EXISTS (
       SELECT 1 FROM public.corredores c
        WHERE cs.chave = 'corredores:' || c.sala_id::text)
     AND NOT EXISTS (
       SELECT 1 FROM public.estantes e
        WHERE cs.chave = 'estantes:' || e.sala_id::text || '|' || e.corredor_id::text)
     AND NOT EXISTS (
       SELECT 1 FROM public.prateleiras p
        WHERE cs.chave = 'prateleiras:' || p.estante_id::text)
     AND NOT EXISTS (
       SELECT 1 FROM public.caixas cx
        WHERE cs.chave = 'caixas:' || cx.prateleira_id::text);

  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  IF v_apagados > 0 THEN
    RAISE NOTICE 'Contadores de escopo sem dados removidos: %', v_apagados;
  END IF;
END $$;

-- ------------------------------------------------------------
-- VERIFICACOES  (troque pelos ids reais)
--   SELECT public.proximo_codigo('corredores', '<sala_id>');
--     -> proximo codigo daquela sala, sem consumir
--   SELECT public.proximo_codigo('estantes', '<sala_id>|<corredor_id>');
--     -> proximo codigo daquela sala naquele corredor
--   SELECT public.gerar_codigo('estantes', '<sala_id>|<corredor_id>');
--     -> consome (E-001, E-002 ... do par)
--   SELECT public.proximo_codigo('prateleiras', '<estante_id>');
--     -> proximo codigo daquele estante (sala+corredor+estante),
--        sem consumir
--   SELECT public.gerar_codigo('prateleiras', '<estante_id>');
--     -> consome (P-0001, P-0002 ... daquele estante)
--   SELECT public.proximo_codigo('caixas', '<prateleira_id>');
--     -> proximo codigo daquela prateleira (sala+corredor+
--        estante+prateleira), sem consumir
--   SELECT public.gerar_codigo('caixas', '<prateleira_id>');
--     -> consome (CX-000001, CX-000002 ... daquela prateleira)
--   SELECT public.proximo_codigo('estantes');
--     -> esperado: ERRO "exige o escopo"
--   SELECT public.proximo_codigo('prateleiras');
--     -> esperado: ERRO "exige o escopo"
--   SELECT public.proximo_codigo('caixas');
--     -> esperado: ERRO "exige o escopo"
--   SELECT public.proximo_codigo('salas');
--     -> continua global (SL-001, SL-002, ...)
--   SELECT chave, ultimo FROM public.codigo_sequencia
--    WHERE chave LIKE 'corredores%' OR chave LIKE 'estantes%'
--       OR chave LIKE 'prateleiras%' OR chave LIKE 'caixas%'
--    ORDER BY chave;
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE indexname IN ('corredores_sala_codigo_unico',
--                        'estantes_sala_corredor_codigo_unico',
--                        'prateleiras_estante_codigo_unico',
--                        'caixas_prateleira_codigo_unico');
-- ------------------------------------------------------------
