-- ============================================================
-- SGA | 13_codigos_automaticos.sql
-- Codigo automatico por sequencia nas secoes da tela
-- Cadastro > Salas de Arquivo:
--   Sala:       SL-001     (3 digitos)
--   Corredor:   C-001      (3 digitos)
--   Estante:    E-001      (3 digitos)
--   Prateleira: P-0001     (4 digitos)
--   Caixa:      CX-000001  (6 digitos)
--
-- Mesmo padrao do protocolo (sql/09): a sequencia e reservada
-- SOMENTE pelo banco, com advisory lock por chave - sem MAX+1
-- no cliente e sem codigo repetido em envio simultaneo.
--
-- A primeira vez que uma chave e usada, a sequencia parte do
-- maior numero ja existente na tabela (codigos legados como
-- "S01", "E01", "CX-001" sao considerados).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 12_capacidade_localizacoes.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabela de sequencia: um contador por tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.codigo_sequencia (
  chave  text PRIMARY KEY,
  ultimo bigint NOT NULL DEFAULT 0
);

-- Ninguem escreve/le direto; so as funcoes (SECURITY DEFINER)
REVOKE ALL ON public.codigo_sequencia FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) gerar_codigo(chave): RESERVA o proximo codigo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_codigo(p_chave text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefixo text;
  v_digitos int;
  v_tabela  text;
  v_max     bigint;
  v_ultimo  bigint;
  v_num     text;
BEGIN
  CASE p_chave
    WHEN 'salas'       THEN v_prefixo := 'SL'; v_digitos := 3; v_tabela := 'salas';
    WHEN 'corredores'  THEN v_prefixo := 'C';  v_digitos := 3; v_tabela := 'corredores';
    WHEN 'estantes'    THEN v_prefixo := 'E';  v_digitos := 3; v_tabela := 'estantes';
    WHEN 'prateleiras' THEN v_prefixo := 'P';  v_digitos := 4; v_tabela := 'prateleiras';
    WHEN 'caixas'      THEN v_prefixo := 'CX'; v_digitos := 6; v_tabela := 'caixas';
    ELSE RAISE EXCEPTION 'Chave de codigo desconhecida: %', p_chave;
  END CASE;

  -- trava uma por chave (liberada no commit/rollback): sem corrida
  PERFORM pg_advisory_xact_lock(870111, hashtext(p_chave));

  -- primeira uso da chave: parte do maior numero ja existente
  IF NOT EXISTS (SELECT 1 FROM public.codigo_sequencia WHERE chave = p_chave) THEN
    EXECUTE format(
      'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I',
      v_tabela) INTO v_max;
    INSERT INTO public.codigo_sequencia (chave, ultimo) VALUES (p_chave, COALESCE(v_max, 0));
  END IF;

  UPDATE public.codigo_sequencia
     SET ultimo = ultimo + 1
   WHERE chave = p_chave
  RETURNING ultimo INTO v_ultimo;

  v_num := CASE WHEN length(v_ultimo::text) >= v_digitos
                THEN v_ultimo::text
                ELSE lpad(v_ultimo::text, v_digitos, '0') END;
  RETURN format('%s-%s', v_prefixo, v_num);
END;
$$;

-- ------------------------------------------------------------
-- 3) proximo_codigo(chave): MESMO valor, porem sem consumir.
--    Usado so para exibir no campo (somente leitura) da tela.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proximo_codigo(p_chave text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prefixo text;
  v_digitos int;
  v_tabela  text;
  v_max     bigint;
  v_seq     bigint;
  v_ultimo  bigint;
  v_num     text;
BEGIN
  CASE p_chave
    WHEN 'salas'       THEN v_prefixo := 'SL'; v_digitos := 3; v_tabela := 'salas';
    WHEN 'corredores'  THEN v_prefixo := 'C';  v_digitos := 3; v_tabela := 'corredores';
    WHEN 'estantes'    THEN v_prefixo := 'E';  v_digitos := 3; v_tabela := 'estantes';
    WHEN 'prateleiras' THEN v_prefixo := 'P';  v_digitos := 4; v_tabela := 'prateleiras';
    WHEN 'caixas'      THEN v_prefixo := 'CX'; v_digitos := 6; v_tabela := 'caixas';
    ELSE RAISE EXCEPTION 'Chave de codigo desconhecida: %', p_chave;
  END CASE;

  EXECUTE format(
    'SELECT COALESCE(max(NULLIF(regexp_replace(codigo, ''\D'', '''', ''g''), '''')::bigint), 0) FROM public.%I',
    v_tabela) INTO v_max;

  SELECT COALESCE(MAX(ultimo), 0) INTO v_seq
    FROM public.codigo_sequencia
   WHERE chave = p_chave;

  v_ultimo := GREATEST(COALESCE(v_seq, 0), COALESCE(v_max, 0)) + 1;

  v_num := CASE WHEN length(v_ultimo::text) >= v_digitos
                THEN v_ultimo::text
                ELSE lpad(v_ultimo::text, v_digitos, '0') END;
  RETURN format('%s-%s', v_prefixo, v_num);
END;
$$;

-- ------------------------------------------------------------
-- 4) Unicidade: o banco passa a barrar codigo repetido.
--    (se ja existirem duplicados, o indice nao sobe - aviso abaixo)
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['salas', 'corredores', 'estantes', 'prateleiras', 'caixas'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (codigo)',
                     t || '_codigo_unico', t);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Indice unico de % nao criado (codigos duplicados?): %', t, SQLERRM;
    END;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5) Permissoes: apenas usuarios autenticados (nao anon)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gerar_codigo(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proximo_codigo(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.gerar_codigo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.proximo_codigo(text) TO authenticated;

-- ------------------------------------------------------------
-- VERIFICACOES
--   SELECT public.proximo_codigo('salas');      -- mostra sem consumir
--   SELECT public.gerar_codigo('salas');        -- consome (SL-001, SL-002, ...)
--   SELECT * FROM public.codigo_sequencia ORDER BY chave;
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE indexname LIKE '%_codigo_unico' ORDER BY tablename;
-- ------------------------------------------------------------
