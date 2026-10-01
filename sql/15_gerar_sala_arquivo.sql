-- ============================================================
-- SGA | 15_gerar_sala_arquivo.sql
-- Aba "Gerar Sala de Arquivo" (Cadastro > Salas de Arquivo):
-- com UM clique no botao Calcular, cria a sala e gera toda a
-- estrutura seguindo o MESMO conceito do cadastro manual:
--
--   Sala        -> SL-001 (sequencia global)
--   Corredores  -> C-001 ...   (sequencia POR SALA)
--   Estantes    -> E-001 ...   (sequencia POR SALA + CORREDOR)
--   Prateleiras -> P-0001 ...  (sequencia POR ESTANTE)
--   Caixas      -> CX-000001 ..(sequencia POR PRATELEIRA)
--
-- Todos os codigos sao reservados pela MESMA funcao
-- gerar_codigo() usada no formulario manual (sql/13 + sql/14),
-- com o escopo de cada nivel - por isso os codigos sao
-- identicos aos do cadastro um a um.
--
-- Capacidades preenchidas como no formulario manual:
--   sala / corredor -> quantidade de Estantes
--   estante         -> quantidade de Prateleiras
--   prateleira      -> quantidade de Caixas
--   caixa           -> 5 pastas (padrao do formulario)
--
-- Tudo em UMA transacao: ou nasce a sala inteira, ou nada
-- (sem ficar corredor meio criado em caso de falha de rede).
--
-- Seguranca: SECURITY INVOKER -> a RLS do usuario autenticado
-- vale exatamente igual aos inserts manuais (anon continua de
-- fora, mesma politica dos demais scripts).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 14_codigos_escopo_localizacoes.sql.
-- ============================================================

CREATE OR REPLACE FUNCTION public.gerar_sala_arquivo(
  p_nome        text,
  p_corredores  int,
  p_estantes    int,
  p_prateleiras int,
  p_caixas      int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome       text := btrim(coalesce(p_nome, ''));
  v_corr       int  := coalesce(p_corredores, 0);
  v_est        int  := coalesce(p_estantes, 0);
  v_prat       int  := coalesce(p_prateleiras, 0);
  v_cx         int  := coalesce(p_caixas, 0);
  v_total_est  int;
  v_total_prat int;
  v_total_cx   int;
  v_sala_cod   text;
  v_sala_id    public.salas.id%TYPE;
  v_corr_id    public.corredores.id%TYPE;
  v_est_id     public.estantes.id%TYPE;
  v_prat_id    public.prateleiras.id%TYPE;
  i            int;
  j            int;
  k            int;
  m            int;
BEGIN
  -- ----------------------------------------------------------
  -- Validacoes: mesmos limites do cadastro manual
  -- ----------------------------------------------------------
  IF v_nome = '' THEN
    RAISE EXCEPTION 'Informe o nome da sala.';
  END IF;
  IF v_corr < 1 OR v_corr > 99 THEN
    RAISE EXCEPTION 'Quantidade de corredores invalida: use 1 a 99.';
  END IF;
  IF v_est < 1 OR v_est > 99 THEN
    RAISE EXCEPTION 'Quantidade de estantes invalida: use 1 a 99.';
  END IF;
  IF v_prat < 1 OR v_prat > 8 THEN
    RAISE EXCEPTION 'Quantidade de prateleiras invalida: use 1 a 8 (maximo por estante).';
  END IF;
  IF v_cx < 1 OR v_cx > 4 THEN
    RAISE EXCEPTION 'Quantidade de caixas por prateleira invalida: use 1 a 4 (ate 32 por estante).';
  END IF;

  v_total_est  := v_corr * v_est;
  v_total_prat := v_total_est * v_prat;
  v_total_cx   := v_total_prat * v_cx;

  IF v_total_est > 999 THEN
    RAISE EXCEPTION 'Total de estantes (%) maior que 999 (capacidade maxima da sala).', v_total_est;
  END IF;
  IF v_total_cx > 10000 THEN
    RAISE EXCEPTION 'Total de caixas (%) maior que 10000. Reduza as quantidades.', v_total_cx;
  END IF;

  -- ----------------------------------------------------------
  -- 1) Sala (sequencia global, mesmas colunas do form manual)
  -- ----------------------------------------------------------
  v_sala_cod := public.gerar_codigo('salas');
  INSERT INTO public.salas (codigo, descricao, capacidade)
  VALUES (v_sala_cod, v_nome, v_total_est)
  RETURNING id INTO v_sala_id;

  -- ----------------------------------------------------------
  -- 2) Corredores -> 3) Estantes -> 4) Prateleiras -> 5) Caixas.
  --    Cada INSERT usa gerar_codigo(chave, escopo) na MESMA
  --    ordem/escopo do cadastro manual.
  -- ----------------------------------------------------------
  FOR i IN 1 .. v_corr LOOP
    INSERT INTO public.corredores (codigo, sala_id, descricao, capacidade)
    VALUES (public.gerar_codigo('corredores', v_sala_id::text),
            v_sala_id, NULL, v_est)
    RETURNING id INTO v_corr_id;

    FOR j IN 1 .. v_est LOOP
      INSERT INTO public.estantes (codigo, sala_id, corredor_id, descricao, capacidade)
      VALUES (public.gerar_codigo('estantes', v_sala_id::text || '|' || v_corr_id::text),
              v_sala_id, v_corr_id, NULL, v_prat)
      RETURNING id INTO v_est_id;

      FOR k IN 1 .. v_prat LOOP
        INSERT INTO public.prateleiras (codigo, estante_id, descricao, capacidade)
        VALUES (public.gerar_codigo('prateleiras', v_est_id::text),
                v_est_id, NULL, v_cx)
        RETURNING id INTO v_prat_id;

        FOR m IN 1 .. v_cx LOOP
          INSERT INTO public.caixas (codigo, sala_id, estante_id, prateleira_id, descricao, capacidade)
          VALUES (public.gerar_codigo('caixas', v_prat_id::text),
                  v_sala_id, v_est_id, v_prat_id, NULL, 5);
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'sala_id',     v_sala_id::text,
    'sala_codigo', v_sala_cod,
    'corredores',  v_corr,
    'estantes',    v_total_est,
    'prateleiras', v_total_prat,
    'caixas',      v_total_cx
  );
END;
$$;

-- ------------------------------------------------------------
-- Permissoes: apenas usuarios autenticados (nao anon),
-- mesmo padrao do 13/14.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gerar_sala_arquivo(text, int, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_sala_arquivo(text, int, int, int, int) TO authenticated;

-- ------------------------------------------------------------
-- VERIFICACOES
--   SELECT public.gerar_sala_arquivo('Sala de Teste', 2, 3, 4, 5);
--     -> { "sala_id": "...", "sala_codigo": "SL-0xx",
--          "corredores": 2, "estantes": 6,
--          "prateleiras": 24, "caixas": 120 }
--   SELECT codigo FROM public.salas ORDER BY codigo;
--   SELECT count(*) FROM public.caixas;   -- subiu 120
--
--   Apagar uma sala de teste (ordem das FKs):
--     DELETE FROM public.caixas      WHERE sala_id = '<sala_id>';
--     DELETE FROM public.prateleiras WHERE estante_id IN
--       (SELECT id FROM public.estantes  WHERE sala_id = '<sala_id>');
--     DELETE FROM public.estantes    WHERE sala_id = '<sala_id>';
--     DELETE FROM public.corredores  WHERE sala_id = '<sala_id>';
--     DELETE FROM public.salas       WHERE id = '<sala_id>';
--   Depois rode de novo o 14_codigos_escopo_localizacoes.sql
--   para limpar os contadores de codigo orfaos (passo 5).
--
--   Esperado SEM o 15 executado (front ja avisa):
--     erro "RPC gerar_sala_arquivo ausente. Execute sql/15 ...".
-- ------------------------------------------------------------
