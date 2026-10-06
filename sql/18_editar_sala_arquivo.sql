-- ============================================================
-- SGA | 18_editar_sala_arquivo.sql
-- Aba "Editar Arquivo" (Cadastro): manutencao da estrutura de
-- uma sala de arquivo existente - remover e transferir.
--
-- A tela (dashboard.html, #tab-local) deixa de ter os 5
-- formularios de inclusao (sala/corredor/estante/prateleira/
-- caixa) e passa a editar a sala escolhida e a arvore
-- estante -> prateleira -> caixa. As INCLUSOES continuam no
-- front (insert + gerar_codigo, como no cadastro manual); o que
-- precisa de transacao e de regra fica aqui:
--
--   remover_caixa(p_caixa_id)
--   remover_prateleira(p_prateleira_id)
--   remover_estante(p_estante_id)
--   transferir_estante(p_estante_id, p_sala_id)
--   transferir_caixa(p_caixa_id, p_sala_id, p_estante_id,
--                    p_prateleira_id)
--   gerar_codigo_livre(p_chave, p_escopo) / proximo_codigo_livre
--     (mesmo que gerar_codigo/proximo_codigo, mas antes de
--      consumir um numero novo devolvem o menor BURACO da
--      sequencia daquele escopo)
--
-- REGRAS
-- ------------------------------------------------------------
-- 1) REMOVER e CASCATA: remover estante apaga as prateleiras e
--    caixas dela; remover prateleira apaga as caixas dela.
-- 2) REMOVER e BLOQUEIO POR DOCUMENTO: se alguma caixa do que
--    esta sendo removido tem documento arquivado, a funcao
--    RECUSA e diz quantos. Os documentos (e os emprestimos
--    apontando para eles) nunca saem do acervo por efeito
--    colateral.
-- 3) TRANSFERIR move a estante INTEIRA (prateleiras + caixas)
--    ou uma caixa, e RENUMERA os codigos na sequencia da sala
--    de destino - o codigo e unico DENTRO da sala
--    (caixas: unico em (sala_id, codigo)), entao manter o
--    codigo antigo colidiria com uma caixa ja existente la.
--    Na MESMA sala nada e renumerado: o codigo ja e unico la e a
--    caixa so troca de estante/prateleira.
-- 4) CODIGO AO VOLTAR: na transferir_caixa o codigo de destino
--    vem da gerar_codigo_livre, que procura primeiro um BURACO na
--    sequencia da sala (menor numero livre de verdade) antes de
--    consumir o proximo do contador. Caixa que volta para a sala
--    recupera o codigo que tinha (CX-000001 em vez de CX-000164)
--    e a sequencia nao ganha buraco.
--    O transferir_estante NAO usa esta funcao: ele reserva todos
--    os codigos das caixas num laco ANTES de gravar qualquer um
--    (secao 4) e, com buraco, todas as reservas sairiam iguais.
--
-- POR QUE O "CODIGO TEMPORARIO"
-- ------------------------------------------------------------
-- Vale so para TROCA DE SALA (na mesma sala a funcao nem entra
-- nesse caminho). O indice unico de caixas e (sala_id, codigo). Ao mover
-- CX-000007 da sala A para a B, em qualquer ordem os estados
-- intermediarios colidem: com o codigo novo ainda na sala A
-- (A ja pode ter CX-000001) ou com o codigo velho na sala B
-- (B pode ter CX-000007). Por isso a funcao:
--   1) coloca um codigo TEMPORARIO na linha (derivado do id,
--      sem digitos - ver abaixo);
--   2) reserva o codigo FINAL na sequencia do destino;
--   3) muda a sala;
--   4) aplica o codigo final.
-- O temporario precisa ser SEM DIGITO porque o bootstrap da
-- sequencia (sql/14) calcula o maior codigo com
-- regexp_replace(codigo, '\D', '', 'g') - um temporario com
-- digito alto inflaria o contador do destino para sempre.
-- '~' + id com todo digito virado 'D' resolve: unico (o id e
-- unico), sem digito e sem conflito com CX-/P-/E-.
--
-- Os prateleiras NAO sao renumeradas: o indice e
-- (estante_id, codigo) e a estante mantem o id na transferencia.
--
-- SEGURANCA
-- ------------------------------------------------------------
-- SECURITY INVOKER em todas: a RLS do usuario autenticado vale
-- exatamente igual aos inserts manuais. REVOKE de PUBLIC/anon e
-- GRANT para authenticated, mesmo padrao do 13/14/16/17.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 17_gerar_sala_arquivo_linha_coluna.sql.
-- Depois de rodar: recarregue o navegador (Ctrl+F5).
-- ============================================================


-- ============================================================
-- 1) REMOVER CAIXA
-- ============================================================
CREATE OR REPLACE FUNCTION public.remover_caixa(
  p_caixa_id public.caixas.id%TYPE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cod  text;
  v_docs bigint;
BEGIN
  SELECT c.codigo INTO v_cod
    FROM public.caixas c WHERE c.id = p_caixa_id;
  IF v_cod IS NULL THEN
    RAISE EXCEPTION 'Caixa nao encontrada.';
  END IF;

  SELECT count(*) INTO v_docs
    FROM public.documentos d WHERE d.caixa_id = p_caixa_id;

  IF v_docs > 0 THEN
    RAISE EXCEPTION
      'Nao e possivel remover a caixa %: ela tem % documento(s) arquivado(s). '
      'Mova os documentos para outra caixa ou exclua-os antes.',
      v_cod, v_docs;
  END IF;

  DELETE FROM public.caixas WHERE id = p_caixa_id;

  RETURN jsonb_build_object('codigo', v_cod, 'documentos', 0);
END;
$$;

-- ============================================================
-- 2) REMOVER PRATELEIRA (cascata nas caixas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.remover_prateleira(
  p_prateleira_id public.prateleiras.id%TYPE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cod   text;
  v_est   public.estantes.id%TYPE;
  v_cx    int;
  v_docs  bigint;
BEGIN
  SELECT p.codigo, p.estante_id INTO v_cod, v_est
    FROM public.prateleiras p WHERE p.id = p_prateleira_id;
  IF v_cod IS NULL THEN
    RAISE EXCEPTION 'Prateleira nao encontrada.';
  END IF;

  SELECT count(*) INTO v_cx
    FROM public.caixas WHERE prateleira_id = p_prateleira_id;

  SELECT count(*) INTO v_docs
    FROM public.documentos d
    JOIN public.caixas c ON c.id = d.caixa_id
   WHERE c.prateleira_id = p_prateleira_id;

  IF v_docs > 0 THEN
    RAISE EXCEPTION
      'Nao e possivel remover a prateleira %: ela tem % documento(s) arquivado(s) '
      'em % caixa(s). Mova os documentos ou exclua-os antes.',
      v_cod, v_docs, v_cx;
  END IF;

  DELETE FROM public.caixas      WHERE prateleira_id = p_prateleira_id;
  DELETE FROM public.prateleiras WHERE id            = p_prateleira_id;

  RETURN jsonb_build_object(
    'codigo', v_cod, 'estante_id', v_est::text, 'caixas', v_cx);
END;
$$;

-- ============================================================
-- 3) REMOVER ESTANTE (cascata em prateleiras e caixas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.remover_estante(
  p_estante_id public.estantes.id%TYPE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cod   text;
  v_sala  public.salas.id%TYPE;
  v_prat  int;
  v_cx    int;
  v_docs  bigint;
BEGIN
  SELECT e.codigo, e.sala_id INTO v_cod, v_sala
    FROM public.estantes e WHERE e.id = p_estante_id;
  IF v_cod IS NULL THEN
    RAISE EXCEPTION 'Estante nao encontrada.';
  END IF;

  SELECT count(*) INTO v_prat
    FROM public.prateleiras WHERE estante_id = p_estante_id;

  SELECT count(*) INTO v_cx
    FROM public.caixas WHERE estante_id = p_estante_id;

  SELECT count(*) INTO v_docs
    FROM public.documentos d
    JOIN public.caixas c ON c.id = d.caixa_id
   WHERE c.estante_id = p_estante_id;

  IF v_docs > 0 THEN
    RAISE EXCEPTION
      'Nao e possivel remover a estante %: ela tem % documento(s) arquivado(s) '
      'em % caixa(s). Mova os documentos ou exclua-os antes.',
      v_cod, v_docs, v_cx;
  END IF;

  DELETE FROM public.caixas      WHERE estante_id = p_estante_id;
  DELETE FROM public.prateleiras WHERE estante_id = p_estante_id;
  DELETE FROM public.estantes    WHERE id         = p_estante_id;

  RETURN jsonb_build_object(
    'codigo', v_cod, 'sala_id', v_sala::text,
    'prateleiras', v_prat, 'caixas', v_cx);
END;
$$;

-- ============================================================
-- 4) TRANSFERIR ESTANTE (sala inteira: estante + prateleiras +
--    caixas). Codigos renumerados no destino.
-- ============================================================
CREATE OR REPLACE FUNCTION public.transferir_estante(
  p_estante_id public.estantes.id%TYPE,
  p_sala_id    public.salas.id%TYPE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_est_cod   text;
  v_antiga    public.salas.id%TYPE;
  v_corr      public.corredores.id%TYPE;
  v_escopo    text;
  v_novo_cod  text;
  v_ids       public.caixas.id%TYPE[];
  v_cods      text[] := '{}';
  v_prat      int;
  v_cx        int;
  i           int;
BEGIN
  SELECT e.codigo, e.sala_id, e.corredor_id
    INTO v_est_cod, v_antiga, v_corr
    FROM public.estantes e WHERE e.id = p_estante_id;
  IF v_est_cod IS NULL THEN
    RAISE EXCEPTION 'Estante nao encontrada.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.salas s WHERE s.id = p_sala_id) THEN
    RAISE EXCEPTION 'Sala de destino nao encontrada.';
  END IF;
  IF v_antiga::text = p_sala_id::text THEN
    RAISE EXCEPTION 'A estante % ja esta nesta sala.', v_est_cod;
  END IF;

  -- O corredor so acompanha a estante se ele PERTENCER a sala de
  -- destino (sala antiga com corredores); caso contrario a
  -- estante entra sem corredor, como nas salas geradas.
  IF v_corr IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.corredores c
        WHERE c.id = v_corr AND c.sala_id::text = p_sala_id::text) THEN
    v_corr := NULL;
  END IF;

  SELECT count(*) INTO v_prat
    FROM public.prateleiras WHERE estante_id = p_estante_id;
  SELECT count(*) INTO v_cx
    FROM public.caixas WHERE estante_id = p_estante_id;

  -- ----------------------------------------------------------
  -- ESTANTE: temporario -> muda de sala (e de corredor) ->
  -- codigo final. O escopo do codigo acompanha o corredor, se
  -- houver, para nao misturar com a sequencia so-da-sala.
  -- ----------------------------------------------------------
  IF v_corr IS NOT NULL THEN
    v_escopo := p_sala_id::text || '|' || v_corr::text;
  ELSE
    v_escopo := p_sala_id::text;
  END IF;
  v_novo_cod := public.gerar_codigo('estantes', v_escopo);

  UPDATE public.estantes
     SET codigo = regexp_replace('~' || p_estante_id::text, '[0-9]', 'D', 'g')
   WHERE id = p_estante_id;
  UPDATE public.estantes
     SET sala_id = p_sala_id, corredor_id = v_corr
   WHERE id = p_estante_id;
  UPDATE public.estantes
     SET codigo = v_novo_cod
   WHERE id = p_estante_id;

  -- ----------------------------------------------------------
  -- CAIXAS: uma a uma, na mesma dance. A reserva do codigo final
  -- acontece enquanto a caixa ainda esta na sala de ORIGEM, para
  -- que o bootstrap da sequencia do destino veja so as caixas
  -- que ja estavam la.
  --
  -- AQUI e obrigatorio o gerar_codigo COMUM (contador): as N
  -- reservas acontecem todas ANTES de qualquer linha ser gravada,
  -- entao a gerar_codigo_livre devolveria o MESMO buraco N vezes
  -- e a gravacao quebraria no indice unico (sql/20).
  -- ----------------------------------------------------------
  SELECT array_agg(c.id ORDER BY c.id) INTO v_ids
    FROM public.caixas c WHERE c.estante_id = p_estante_id;

  FOR i IN 1 .. COALESCE(cardinality(v_ids), 0) LOOP
    UPDATE public.caixas
       SET codigo = regexp_replace('~' || v_ids[i]::text, '[0-9]', 'D', 'g')
     WHERE id = v_ids[i];
    v_cods := v_cods || public.gerar_codigo('caixas', p_sala_id::text);
  END LOOP;

  UPDATE public.caixas
     SET sala_id = p_sala_id
   WHERE estante_id = p_estante_id;

  FOR i IN 1 .. COALESCE(cardinality(v_ids), 0) LOOP
    UPDATE public.caixas
       SET codigo = v_cods[i]
     WHERE id = v_ids[i];
  END LOOP;

  RETURN jsonb_build_object(
    'codigo_anterior', v_est_cod,
    'codigo_novo',     v_novo_cod,
    'prateleiras',     v_prat,
    'caixas',          v_cx);
END;
$$;

-- ============================================================
-- 5) GERAR / MOSTRAR CODIGO LIVRE (devolve o buraco)
--
-- Mesma receita do gerar_codigo / proximo_codigo (sql/13 + 14):
-- trava advisory por chave+escopo, bootstrap a partir dos dados e
-- contador em public.codigo_sequencia. A diferenca e que, ANTES de
-- consumir um numero novo, elas procuram um BURACO: o menor numero
-- de 1..maximo do escopo que nenhuma linha ocupa.
--
-- Quem usa: a transferir_caixa (secao 6). Assim a caixa que volta
-- para a sala recupera o codigo que tinha (CX-000001) em vez de
-- pular para o fim da fila (CX-000164), e a sequencia da sala
-- fica sem buraco.
--
-- NAO troque o gerar_codigo comum por esta funcao nos lacos de
-- reserva (transferir_estante, gerar_sala): la TODAS as reservas
-- sao feitas antes de gravar as linhas e cada volta do laco
-- devolveria o MESMO buraco - o indice unico rejeitaria a grava-
-- cao (e e justamente o que o sql/20 explica sobre a contagem).
--
-- Por que a busca nao pega uma reserva pendente: o contador nunca
-- fica ATRAS dos dados (bootstrap + sql/20 + o passo de baixo),
-- entao todo numero ja reservado esta ACIMA do maximo - e a
-- procura de buraco vai so ate' o maximo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.gerar_codigo_livre(
  p_chave  text,
  p_escopo text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefixo   text;
  v_digitos   int;
  v_tabela    text;
  v_colunas   text[] := NULL;   -- colunas do escopo, na ordem de p_escopo
  v_chave_seq text;             -- chave em codigo_sequencia
  v_filtro    text := '';       -- WHERE do escopo
  v_vals      text[];
  v_max       bigint;           -- maior numero que EXISTE no escopo
  v_livre     bigint;           -- menor numero LIVRE (buraco)
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
                           v_colunas := ARRAY['sala_id'];
    ELSE RAISE EXCEPTION 'Chave de codigo desconhecida: %', p_chave;
  END CASE;

  IF v_colunas IS NOT NULL THEN
    IF p_escopo IS NULL OR btrim(p_escopo) = '' THEN
      RAISE EXCEPTION 'Esta chave exige o escopo (valores separados por |) em p_escopo.'
        USING DETAIL = 'chave=' || COALESCE(p_chave, '(nula)');
    END IF;
    v_vals := string_to_array(p_escopo, '|');
    IF cardinality(v_vals) < 1 OR cardinality(v_vals) > cardinality(v_colunas) THEN
      RAISE EXCEPTION 'Escopo invalido para esta chave.'
        USING DETAIL = format('ate %s valor(es), na ordem: %s | informado: %s',
                              cardinality(v_colunas),
                              array_to_string(v_colunas, ' | '), p_escopo);
    END IF;
    IF '' = ANY (v_vals) THEN
      RAISE EXCEPTION 'Escopo com valor vazio.'
        USING DETAIL = 'chave=' || p_chave || ' | escopo=' || p_escopo;
    END IF;
    v_chave_seq := p_chave || ':' || p_escopo;
    FOR i IN 1 .. cardinality(v_vals) LOOP
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

  -- mesma trava do gerar_codigo: dois geradores no mesmo escopo
  -- nao enxergam um buraco ao mesmo tempo
  PERFORM pg_advisory_xact_lock(870111, hashtext(v_chave_seq));

  -- bootstrap igual ao do gerar_codigo (primeiro uso da chave)
  IF NOT EXISTS (SELECT 1 FROM public.codigo_sequencia WHERE chave = v_chave_seq) THEN
    EXECUTE format(
      'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I%s',
      v_tabela, v_filtro) INTO v_max;
    INSERT INTO public.codigo_sequencia (chave, ultimo)
    VALUES (v_chave_seq, COALESCE(v_max, 0));
  END IF;

  -- maior numero que existe HOJE no escopo (toda chamada, nao so
  -- na primeira): e o teto da busca de buraco
  EXECUTE format(
    'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I%s',
    v_tabela, v_filtro) INTO v_max;

  -- buraco: 1..maximo MENOS os numeros que a tabela ja usa
  -- (codigo sem digito, tipo o temporario '~DDDD', vira NULL e nao
  -- derruba nenhum candidato)
  EXECUTE format(
    'SELECT min(n) FROM (
       SELECT generate_series(1, %s) AS n
       EXCEPT
       SELECT NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint
         FROM public.%I%s
     ) t',
    GREATEST(COALESCE(v_max, 0), 0), v_tabela, v_filtro)
    INTO v_livre;

  IF v_livre IS NOT NULL THEN
    -- devolve o buraco: o contador nao consome numero novo, so
    -- garante que nao fica atras dos dados
    v_ultimo := v_livre;
    UPDATE public.codigo_sequencia
       SET ultimo = GREATEST(ultimo, COALESCE(v_max, 0))
     WHERE chave = v_chave_seq;
  ELSE
    -- sem buraco: segue a fila, igual ao gerar_codigo
    UPDATE public.codigo_sequencia
       SET ultimo = GREATEST(ultimo, COALESCE(v_max, 0)) + 1
     WHERE chave = v_chave_seq
    RETURNING ultimo INTO v_ultimo;
  END IF;

  v_num := CASE WHEN length(v_ultimo::text) >= v_digitos
                THEN v_ultimo::text
                ELSE lpad(v_ultimo::text, v_digitos, '0') END;
  RETURN format('%s-%s', v_prefixo, v_num);
END;
$$;

CREATE OR REPLACE FUNCTION public.proximo_codigo_livre(
  p_chave  text,
  p_escopo text DEFAULT NULL
)
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
  v_livre     bigint;
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
                           v_colunas := ARRAY['sala_id'];
    ELSE RAISE EXCEPTION 'Chave de codigo desconhecida: %', p_chave;
  END CASE;

  IF v_colunas IS NOT NULL THEN
    IF p_escopo IS NULL OR btrim(p_escopo) = '' THEN
      RAISE EXCEPTION 'Esta chave exige o escopo (valores separados por |) em p_escopo.'
        USING DETAIL = 'chave=' || COALESCE(p_chave, '(nula)');
    END IF;
    v_vals := string_to_array(p_escopo, '|');
    IF cardinality(v_vals) < 1 OR cardinality(v_vals) > cardinality(v_colunas) THEN
      RAISE EXCEPTION 'Escopo invalido para esta chave.'
        USING DETAIL = format('ate %s valor(es), na ordem: %s | informado: %s',
                              cardinality(v_colunas),
                              array_to_string(v_colunas, ' | '), p_escopo);
    END IF;
    IF '' = ANY (v_vals) THEN
      RAISE EXCEPTION 'Escopo com valor vazio.'
        USING DETAIL = 'chave=' || p_chave || ' | escopo=' || p_escopo;
    END IF;
    v_chave_seq := p_chave || ':' || p_escopo;
    FOR i IN 1 .. cardinality(v_vals) LOOP
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

  -- MESMO calculo da gerar_codigo_livre, so que sem consumir nada
  EXECUTE format(
    'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I%s',
    v_tabela, v_filtro) INTO v_max;

  EXECUTE format(
    'SELECT min(n) FROM (
       SELECT generate_series(1, %s) AS n
       EXCEPT
       SELECT NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint
         FROM public.%I%s
     ) t',
    GREATEST(COALESCE(v_max, 0), 0), v_tabela, v_filtro)
    INTO v_livre;

  IF v_livre IS NOT NULL THEN
    v_ultimo := v_livre;
  ELSE
    SELECT COALESCE(MAX(ultimo), 0) INTO v_seq
      FROM public.codigo_sequencia
     WHERE chave = v_chave_seq;
    v_ultimo := GREATEST(COALESCE(v_seq, 0), COALESCE(v_max, 0)) + 1;
  END IF;

  v_num := CASE WHEN length(v_ultimo::text) >= v_digitos
                THEN v_ultimo::text
                ELSE lpad(v_ultimo::text, v_digitos, '0') END;
  RETURN format('%s-%s', v_prefixo, v_num);
END;
$$;

-- ============================================================
-- 6) TRANSFERIR CAIXA (com os documentos que ela guarda) para
--    outra estante/prateleira, na MESMA sala ou em OUTRA sala.
-- ============================================================
CREATE OR REPLACE FUNCTION public.transferir_caixa(
  p_caixa_id      public.caixas.id%TYPE,
  p_sala_id       public.salas.id%TYPE,
  p_estante_id    public.estantes.id%TYPE,
  p_prateleira_id public.prateleiras.id%TYPE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cod      text;
  v_antiga   public.salas.id%TYPE;
  v_novo     text;
  v_docs     bigint;
  v_ja_ocupa int;
BEGIN
  SELECT c.codigo, c.sala_id INTO v_cod, v_antiga
    FROM public.caixas c WHERE c.id = p_caixa_id;
  IF v_cod IS NULL THEN
    RAISE EXCEPTION 'Caixa nao encontrada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.salas s WHERE s.id = p_sala_id) THEN
    RAISE EXCEPTION 'Sala de destino nao encontrada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.estantes e
     WHERE e.id = p_estante_id AND e.sala_id::text = p_sala_id::text) THEN
    RAISE EXCEPTION 'A estante escolhida nao pertence a sala de destino.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.prateleiras p
     WHERE p.id = p_prateleira_id AND p.estante_id::text = p_estante_id::text) THEN
    RAISE EXCEPTION 'A prateleira escolhida nao pertence a estante de destino.';
  END IF;

  IF v_antiga::text = p_sala_id::text
     AND EXISTS (
       SELECT 1 FROM public.caixas c
        WHERE c.id = p_caixa_id
          AND c.estante_id::text    = p_estante_id::text
          AND c.prateleira_id::text = p_prateleira_id::text) THEN
    RAISE EXCEPTION 'A caixa % ja esta nesta prateleira.', v_cod;
  END IF;

  -- Teto da prateleira de destino: 4 caixas (mesmo limite do
  -- formulario manual).
  SELECT count(*) INTO v_ja_ocupa
    FROM public.caixas WHERE prateleira_id = p_prateleira_id;
  IF v_ja_ocupa >= 4 THEN
    RAISE EXCEPTION 'A prateleira de destino ja tem o maximo de 4 caixas.';
  END IF;

  SELECT count(*) INTO v_docs
    FROM public.documentos d WHERE d.caixa_id = p_caixa_id;

  -- Na MESMA sala o codigo nao muda: ele ja e' unico la e renomear
  -- a caixa so confundiria quem ja anotou o codigo.
  -- Em OUTRA sala, temporario (libera o codigo na origem) + reserva
  -- do codigo final no destino; o unico UPDATE seguinte ja escreve
  -- codigo e sala juntos, entao nao ha estado intermediario.
  IF v_antiga::text = p_sala_id::text THEN
    v_novo := v_cod;
  ELSE
    UPDATE public.caixas
       SET codigo = regexp_replace('~' || p_caixa_id::text, '[0-9]', 'D', 'g')
     WHERE id = p_caixa_id;

    v_novo := public.gerar_codigo_livre('caixas', p_sala_id::text);
  END IF;

  UPDATE public.caixas
     SET codigo        = v_novo,
         sala_id       = p_sala_id,
         estante_id    = p_estante_id,
         prateleira_id = p_prateleira_id
   WHERE id = p_caixa_id;

  RETURN jsonb_build_object(
    'codigo_anterior', v_cod,
    'codigo_novo',     v_novo,
    'documentos',      v_docs);
END;
$$;

-- ------------------------------------------------------------
-- Permissoes: apenas usuarios autenticados (nao anon),
-- mesmo padrao do 13/14/16/17.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.remover_caixa(public.caixas.id%TYPE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remover_prateleira(public.prateleiras.id%TYPE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remover_estante(public.estantes.id%TYPE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transferir_estante(public.estantes.id%TYPE, public.salas.id%TYPE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transferir_caixa(public.caixas.id%TYPE, public.salas.id%TYPE, public.estantes.id%TYPE, public.prateleiras.id%TYPE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gerar_codigo_livre(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proximo_codigo_livre(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.remover_caixa(public.caixas.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_prateleira(public.prateleiras.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_estante(public.estantes.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_estante(public.estantes.id%TYPE, public.salas.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_caixa(public.caixas.id%TYPE, public.salas.id%TYPE, public.estantes.id%TYPE, public.prateleiras.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_codigo_livre(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.proximo_codigo_livre(text, text) TO authenticated;

-- ------------------------------------------------------------
-- VERIFICACOES
--
-- Crie uma sala de teste com 18 estantes (linha 3 x coluna 6),
-- 4 prateleiras e 2 caixas por prateleira, e outra sala vazia:
--
--   SELECT public.gerar_sala_arquivo('Sala Origem', 18, 4, 2, 3, 6);
--   SELECT public.gerar_sala_arquivo('Sala Destino', 6, 2, 2, 2, 3);
--
-- -- remover estante SEM documento (funciona, cascata):
--   SELECT public.remover_estante((
--     SELECT id FROM public.estantes
--      WHERE sala_id = (SELECT id FROM public.salas WHERE descricao = 'Sala Origem')
--      ORDER BY codigo LIMIT 1));
--   SELECT count(*) FROM public.prateleiras WHERE estante_id = <estante_id>;  -- 0
--   SELECT count(*) FROM public.caixas      WHERE estante_id = <estante_id>;  -- 0
--
-- -- remover estante COM documento (recusa e diz quantos):
--   -- (cadastre um documento numa caixa antes)
--   ERROR: Nao e possivel remover a estante E-002: ela tem 3
--          documento(s) arquivado(s) em 1 caixa(s). ...
--
-- -- transferir estante (renumera):
--   SELECT public.transferir_estante(<estante_id>, <sala_destino_id>);
--   SELECT linha, coluna, codigo FROM public.estantes
--    WHERE id = <estante_id>;      -- E-00x do destino
--   SELECT codigo FROM public.caixas WHERE estante_id = <estante_id> ORDER BY codigo;
--     -- CX-000001, CX-000002 ... da sala destino, sem repetir
--     -- nenhum codigo que ja existia nela
--
-- -- transferir caixa (leva os documentos junto):
--   SELECT public.transferir_caixa(
--     <caixa_id>, <sala_destino_id>, <estante_destino_id>,
--     <prateleira_destino_id>);
--   -- estante/prateleira de destino de outra sala -> recusa
--
-- -- destinos invalidos:
--   SELECT public.transferir_caixa(<caixa_id>, <sala_id>, <estante_de_outra_sala>, <prat>);
--   ERROR: A estante escolhida nao pertence a sala de destino.
--   SELECT public.transferir_caixa(<caixa_id>, <sala_id>, <est_id>, <prateleira_cheia>);
--   ERROR: A prateleira de destino ja tem o maximo de 4 caixas.
--
-- -- Codigo ao VOLTAR (buraco da sequencia): numa sala que tem
--    CX-000002..CX-000163 (o CX-000001 foi embora):
--   SELECT public.proximo_codigo_livre('caixas', '<sala_id>');
--     -- CX-000001  (o proximo_codigo comum diria CX-000164)
--   SELECT public.proximo_codigo('caixas', '<sala_id>');
--     -- CX-000164  (contador: continua assim no INCLUIR caixa)
--   -- devolva a caixa para a sala e confirme na arvore: ela tem
--   -- de virar CX-000001 e nao CX-000164.
--   -- Sem buraco, as duas funcoes mostram o mesmo numero.
--
-- -- Caixa que JA voltou e ficou com codigo de "fim de fila"
--    (CX-000164 num sala onde o CX-000001 esta livre): os dados
--    nao se consertam sozinhos. Confira que o numero desejado
--    esta livre e corrija (ou transfira a caixa para fora e
--    devolva - ai sim ela busca o menor numero livre sozinha):
--   SELECT codigo FROM public.caixas
--    WHERE sala_id = '<sala_id>' AND codigo = 'CX-000001';   -- 0 linhas
--   UPDATE public.caixas SET codigo = 'CX-000001'
--    WHERE id = '<caixa_id>';
--
-- A arvore da tela mostra o codigo NOVO logo apos a transferencia;
-- se o codigo antigo sumiu do historico, e esperado: o codigo e
-- unico por sala e o registro da mudanca fica na auditoria
-- (trg_auditoria).
--
-- Se o front disser "RPC ausente", a assinatura nao bateu:
-- confira com
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'transferir%'
--      OR n.nspname = 'public' AND p.proname LIKE 'remover_%';
-- ------------------------------------------------------------