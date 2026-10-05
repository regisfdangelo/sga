-- ============================================================
-- SGA | 20_sequencia_correta_apos_apagar.sql
-- Faz a sequencia de codigos voltar a ficar CERTA depois que se
-- apaga (ou se transfere para fora) o ultimo item de uma sala.
--
-- O problema que este script corrige:
--   Sala com 6 estantes (2x3) -> E-001 .. E-006.
--   Apagar a ultima (E-006) e incluir outra de volta vinha com
--   E-007: sobrava um buraco na sequencia para sempre.
--
-- Por que acontecia:
--   public.codigo_sequencia guarda o ULTIMO valor reservado por
--   gerar_codigo(). A funcao so faz o "bootstrap" a partir dos
--   codigos que existem na PRIMEIRA vez que uma chave e usada;
--   depois disso ela so soma 1 no contador. Apagar a E-006
--   nao devolve 6 ao contador, entao ele seguia 6 -> 7.
--
-- Por que a correcao e este reculo do contador e nao trocar a
--   formula por "max dos codigos existentes + 1":
--   o contador e CARGA PESADA. transferir_estante() reserva todos
--   os codigos das caixas num laco ANTES de mover as caixas
--   (sql/18, guarda em v_cods) e so depois os grava. Se o codigo
--   viesse dos dados, todas as reservas do laco seriam iguais e o
--   indice UNIQUE (sala_id, codigo) bararia a gravacao. Por isso
--   gerar_codigo() continua com GREATEST(contador, max dos dados)
--   + 1 - o que o conserto faz e manter o CONTADOR verdadeiro.
--
-- Como:
--   1) fn_recalcula_sequencia(chave, escopo) le os codigos que
--      existem de verdade na tabela e escreve no contador o maximo
--      encontrado. So ATUALIZA linha existente (nao cria), porque
--      o bootstrap continua sendo da primeira gerar_codigo().
--
--   2) um unico trigger fn_seq_recalcula() e ligado nas 5 tabelas
--      que geram codigo (salas, corredores, estantes, prateleiras,
--      caixas), nos eventos AFTER DELETE e AFTER UPDATE:
--        - DELETE            -> o escopo que perdeu a linha;
--        - UPDATE que muda a coluna de escopo (sala_id,
--          corredor_id, estante_id) -> o escopo de ORIGEM;
--        - UPDATE de outro campo (descricao, capacidade...) ->
--          NAO faz nada: mexer no contador aqui apagaria uma
--          reserva acabada de feita pela gerar_codigo().
--
--   3) so o escopo de ORIGEM e recalculado. O de DESTINO nao:
--      la a gerar_codigo() acabou de reservar um codigo e a linha
--      ainda nao existe (a transferencia grava o codigo depois);
--      reescrever agora apagaria a reserva.
--
--   4) as colunas sao lidas com to_jsonb(OLD) ->> 'coluna': se o
--      banco for antigo e nao tiver corredor_id, o valor vem nulo
--      e a funcao para, em vez de quebrar o DELETE com erro de
--      coluna inexistente.
--
-- Sequencias que continuam do jeito que estavam:
--   - remover a E-003 do meio de E-001..E-006 e criar outra
--     ainda devolve E-007 (o maximo dos dados e 6); so o caso do
--     ultimo item deixa de gerar buraco;
--   - nenhuma chamada a gerar_codigo()/proximo_codigo() muda de
--     formula, entao a previa mostrada na tela continua igual ao
--     codigo que sera gravado;
--   - chaves legadas com outro formato (ex.: caixas:<prateleira>
--     usada por sql/15) nao sao recalculadas: nenhum codigo atual
--     passa por elas, elas so existem de antes da sql/16.
--
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 18_editar_sala_arquivo.sql (e 19, se houver).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Recalcula o contador de uma chave de codigo a partir dos
--    codigos que existem na tabela.
--    SECURITY DEFINER de proposito: codigo_sequencia tem REVOKE
--    ALL de PUBLIC/anon/authenticated (sql/13) e este trigger roda
--    dentro de um DELETE feito por um usuario comum.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcula_sequencia(
  p_chave text,
  p_escopo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tabela    text;
  v_colunas   text[] := NULL;
  v_chave_seq text;
  v_filtro    text := '';
  v_vals      text[];
  v_max       bigint;
  v_col       text;
  i           int;
BEGIN
  -- O banco pode nao ter nem a tabela de sequencia nem todas as
  -- colunas (banco montado antes da sql/13/14). Nesse caso nao ha
  -- nada a corrigir: deixa a gerar_codigo() fazer o bootstrap.
  IF to_regclass('public.codigo_sequencia') IS NULL THEN RETURN; END IF;

  CASE p_chave
    WHEN 'salas'       THEN v_tabela := 'salas';
    WHEN 'corredores'  THEN v_tabela := 'corredores'; v_colunas := ARRAY['sala_id'];
    WHEN 'estantes'    THEN v_tabela := 'estantes';   v_colunas := ARRAY['sala_id', 'corredor_id'];
    WHEN 'prateleiras' THEN v_tabela := 'prateleiras';v_colunas := ARRAY['estante_id'];
    WHEN 'caixas'      THEN v_tabela := 'caixas';     v_colunas := ARRAY['sala_id'];
    ELSE RETURN;                                  -- chave que nao gera codigo
  END CASE;

  IF to_regclass('public.' || v_tabela) IS NULL THEN RETURN; END IF;

  -- Todas as colunas usadas tem de existir de fato. Confere antes
  -- para nao falhar o DELETE do usuario com "coluna nao existe".
  FOREACH v_col IN ARRAY COALESCE(v_colunas, '{}'::text[]) || ARRAY['codigo'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name   = v_tabela
                      AND column_name  = v_col) THEN
      RETURN;
    END IF;
  END LOOP;

  IF v_colunas IS NOT NULL THEN
    IF p_escopo IS NULL OR btrim(p_escopo) = '' THEN RETURN; END IF;
    v_vals := string_to_array(p_escopo, '|');
    IF cardinality(v_vals) < 1 OR cardinality(v_vals) > cardinality(v_colunas) THEN RETURN; END IF;
    IF '' = ANY (v_vals) THEN RETURN; END IF;
    v_chave_seq := p_chave || ':' || p_escopo;
    FOR i IN 1 .. cardinality(v_vals) LOOP
      v_filtro := v_filtro || format(' %s %I::text = %L',
                   CASE WHEN i = 1 THEN 'WHERE' ELSE 'AND' END,
                   v_colunas[i], v_vals[i]);
    END LOOP;
  ELSE
    IF p_escopo IS NOT NULL AND btrim(p_escopo) <> '' THEN RETURN; END IF;
    v_chave_seq := p_chave;
  END IF;

  -- Mesmo calculo do bootstrap da gerar_codigo(): o codigo vira
  -- 0 quando tem so letra (ex.: placeholder '~DDDD' que a
  -- transferencia usa enquanto nao decide o codigo final), entao
  -- ele nao infla o maximo.
  EXECUTE format(
    'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I%s',
    v_tabela, v_filtro) INTO v_max;

  -- UPDATE e nao INSERT: nao criamos linha para chave que nunca
  -- foi usada (na primeira gerar_codigo o bootstrap ja cria certa).
  -- GREATEST so para nao rebaixar o contador caso os dados venham
  -- com codigo maior que o contador gravado.
  UPDATE public.codigo_sequencia
     SET ultimo = GREATEST(0, COALESCE(v_max, 0))
   WHERE chave = v_chave_seq;
END;
$$;

-- Privilegio, no padrao do resto do projeto (13/14/18): a funcao
-- vira endpoint de rpc no Supabase e nao deve ficar acessivel para
-- anon nem para PUBLIC. Mas os papéis que APAGAM linha precisam
-- ter EXECUTE, senao o proprio DELETE falharia dentro do trigger:
--   - authenticated: roda remover_*/transferir_* (SECURITY INVOKER);
--   - service_role: papel de servidor, fora do navegador (mesma
--     regra de 05/06); o IF evita quebrar num banco sem ele;
--   - postgres e o dono: mantem o acesso implicito, nao se mexe.
REVOKE ALL ON FUNCTION public.fn_recalcula_sequencia(text, text) FROM PUBLIC, anon;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.fn_recalcula_sequencia(text, text) TO %I', r);
    ELSE
      RAISE NOTICE 'Papel inexistente, grant ignorado: %', r;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2) Trigger unico para as 5 tabelas: quando a linha sai (ou muda
--    de escopo), o contador do escopo de ORIGEM volta para o que
--    os dados dizem.
--    Sem SECURITY DEFINER aqui: a funcao le OLD/NEW e so chama o
--    helper - a gravacao no contador acontece la, com SECURITY
--    DEFINER, porque codigo_sequencia tem REVOKE de PUBLIC.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_seq_recalcula()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cols  text[] := '{}'::text[];
  v_old   jsonb;
  v_new   jsonb;
  v_chave text := TG_TABLE_NAME;
  v1      text;
  v2      text;
  mudou   boolean := false;
  i       int;
BEGIN
  -- As MESMAS colunas de escopo da gerar_codigo(), na mesma ordem.
  v_cols := CASE v_chave
    WHEN 'estantes'    THEN ARRAY['sala_id', 'corredor_id']
    WHEN 'caixas'      THEN ARRAY['sala_id']
    WHEN 'corredores'  THEN ARRAY['sala_id']
    WHEN 'prateleiras' THEN ARRAY['estante_id']
    ELSE '{}'::text[]                  -- salas: nao tem escopo
  END;

  -- salas: chave unica, sem escopo. So DELETE importa.
  IF cardinality(v_cols) = 0 THEN
    IF TG_OP <> 'DELETE' THEN RETURN NEW; END IF;
    PERFORM public.fn_recalcula_sequencia(v_chave, NULL);
    RETURN OLD;
  END IF;

  v_old := to_jsonb(OLD);

  -- UPDATE: so interessa se mudou a coluna de escopo. Mexer no
  -- contador numa edicao qualquer apagaria uma reserva que a
  -- gerar_codigo() acabou de fazer (a linha ainda nem existe).
  IF TG_OP = 'UPDATE' THEN
    v_new := to_jsonb(NEW);
    FOR i IN 1 .. cardinality(v_cols) LOOP
      IF (v_old->>v_cols[i]) IS DISTINCT FROM (v_new->>v_cols[i]) THEN
        mudou := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT mudou THEN RETURN NEW; END IF;
  END IF;

  -- Escopo de ORIGEM, sempre pelo OLD: e o escopo que perdeu a
  -- linha (ou deixou de la). O de DESTINO fica intocado de proposito.
  v1 := v_old->>v_cols[1];
  IF v1 IS NULL THEN
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
    RETURN OLD;
  END IF;
  PERFORM public.fn_recalcula_sequencia(v_chave, v1);

  -- estantes tem duas chaves possiveis: so-da-sala (a que o front
  -- usa ao incluir) e sala|corredor (a das salas com corredor).
  IF cardinality(v_cols) >= 2 THEN
    v2 := v_old->>v_cols[2];
    IF v2 IS NOT NULL THEN
      PERFORM public.fn_recalcula_sequencia(v_chave, v1 || '|' || v2);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  RETURN OLD;
END;
$$;

-- ------------------------------------------------------------
-- 3) Liga o trigger nas 5 tabelas que geram codigo.
--    fn_seq_recalcula() mantem EXECUTE publico de proposito: e a
--    funcao do gatilho, nao e chamada por rpc, e qualquer usuario
--    que consiga apagar linha precisa que ela rode. O que a funcao
--    faz e inofensivo: so grava no contador o maximo que ja existe
--    nos dados - ela nunca consegue inflar a sequencia, apenas
--    devolve-la ao que a tabela diz.
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salas', 'corredores', 'estantes', 'prateleiras', 'caixas'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_seq_recalcula ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_seq_recalcula AFTER DELETE OR UPDATE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.fn_seq_recalcula()', t);
  END LOOP;
END $$;

-- ============================================================
-- VERIFICACAO (rodar depois, uma por vez)
-- ------------------------------------------------------------
-- Formato: estante usa 3 digitos -> E-001 .. E-006.
--
-- Cenario reportado: sala 2x3 com E-001..E-006.
--
--   SELECT public.remover_estante(<id da E-006>);
--   SELECT public.proximo_codigo('estantes', '<sala_id>');
--     -- esperado: E-006  (antes da correcao viria E-007)
--   -- incluir de volta pela tela tem de gravar E-006.
--
-- NAO chame gerar_codigo() so para conferir: ele CONSUME um
-- numero e, sem a linha correspondente, deixa um buraco novo no
-- contador. proximo_codigo() so calcula e nao grava nada.
--
-- Contador nunca fica na frente dos dados:
--   SELECT chave, ultimo FROM public.codigo_sequencia
--    ORDER BY chave;
--
-- Estimando a sequencia de uma sala a partir dos proprios codigos
-- (bate com proximo_codigo, exceto quando ha codigo reservado e
-- ainda nao gravado - que e justamente o que o contador protege):
--   SELECT COALESCE(max(NULLIF(regexp_replace(codigo, '\D', '', 'g'), '')::bigint), 0) + 1
--          AS proximo_pelo_dados
--     FROM public.estantes WHERE sala_id = '<sala_id>';
-- ============================================================
