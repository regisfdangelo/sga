-- ============================================================
-- SGA | 16_gerar_sala_arquivo_sem_corredores.sql
-- Aba "Gerar Sala de Arquivo" (Cadastro > Salas de Arquivo):
-- SUBSTITUI a RPC do 15 removendo o campo de corredores.
-- A sala agora nasce SEM corredores e a quantidade de estantes
-- e LIVRE (digitada pelo usuario, sem o limite de 99 por
-- corredor e sem o calculo corredor x estante):
--
--   Sala        -> SL-001 (sequencia global)
--   Estantes    -> quantidade LIVRE       (sequencia POR SALA;
--                  corredor_id fica NULL - a sala nao tem
--                  corredor)
--   Prateleiras -> P-0001 ...             (sequencia POR ESTANTE)
--   Caixas      -> CX-000001 ..           (sequencia POR SALA -
--                  codigo unico em toda a sala, para o mapa nao
--                  repetir CX-000001 em cada prateleira)
--
-- Todos os codigos sao reservados pela MESMA funcao
-- gerar_codigo() usada no formulario manual (sql/13 + sql/14),
-- com o escopo de cada nivel - por isso os codigos sao
-- identicos aos do cadastro um a um.
--
-- Capacidades preenchidas como no formulario manual:
--   sala            -> quantidade de Estantes
--   estante         -> quantidade de Prateleiras
--   prateleira      -> quantidade de Caixas
--   caixa           -> 5 pastas (padrao do formulario)
--
-- Limites validados ANTES de qualquer INSERT:
--   estantes  -> 1 a 10000 (quantidade livre, guarda de sanidade)
--   prateleiras -> 1 a 8 por estante   (formulario manual)
--   caixas      -> 1 a 4 por prateleira(formulario manual)
--   total de caixas -> 10000 (protege a transacao)
--
-- Tudo em UMA transacao: ou nasce a sala inteira, ou nada.
--
-- Seguranca: SECURITY INVOKER -> a RLS do usuario autenticado
-- vale exatamente igual aos inserts manuais (anon continua de
-- fora, mesma politica dos demais scripts).
--
-- ATENCAO: a assinatura da funcao MUDOU (4 argumentos). Este
-- script da DROP na funcao antiga de 5 argumentos (do 15) e
-- cria a nova. Depois de rodar, recarregue o navegador (Ctrl+F5).
--
-- DEPENDENCIA: a sequencia de estantes e chamada com escopo
-- so-da-sala (gerar_codigo('estantes', '<sala_id>')) e a de
-- caixas tambem (gerar_codigo('caixas', '<sala_id>')). Se o
-- front acusar "Escopo invalido para esta chave.", e porque o
-- banco ainda tem a versao antiga do 14 - rode de novo o
-- sql/14_codigos_escopo_localizacoes.sql (idempotente).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 15_gerar_sala_arquivo.sql.
-- ============================================================

-- Funcao antiga (com p_corredores): fora.
DROP FUNCTION IF EXISTS public.gerar_sala_arquivo(text, int, int, int, int);

CREATE OR REPLACE FUNCTION public.gerar_sala_arquivo(
  p_nome        text,
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
  v_est        int  := coalesce(p_estantes, 0);
  v_prat       int  := coalesce(p_prateleiras, 0);
  v_cx         int  := coalesce(p_caixas, 0);
  v_total_prat int;
  v_total_cx   int;
  v_sala_cod   text;
  v_sala_id    public.salas.id%TYPE;
  v_est_id     public.estantes.id%TYPE;
  v_prat_id    public.prateleiras.id%TYPE;
  j            int;
  k            int;
  m            int;
BEGIN
  -- ----------------------------------------------------------
  -- Validacoes (antes de qualquer INSERT)
  -- ----------------------------------------------------------
  IF v_nome = '' THEN
    RAISE EXCEPTION 'Informe o nome da sala.';
  END IF;
  IF v_est < 1 OR v_est > 10000 THEN
    RAISE EXCEPTION 'Quantidade de estantes invalida: use 1 a 10000.';
  END IF;
  IF v_prat < 1 OR v_prat > 8 THEN
    RAISE EXCEPTION 'Quantidade de prateleiras invalida: use 1 a 8 (maximo por estante).';
  END IF;
  IF v_cx < 1 OR v_cx > 4 THEN
    RAISE EXCEPTION 'Quantidade de caixas por prateleira invalida: use 1 a 4.';
  END IF;

  v_total_prat := v_est * v_prat;
  v_total_cx   := v_total_prat * v_cx;

  IF v_total_cx > 10000 THEN
    RAISE EXCEPTION 'Total de caixas (%) maior que 10000. Reduza as quantidades.', v_total_cx;
  END IF;

  -- ----------------------------------------------------------
  -- 1) Sala (sequencia global, mesmas colunas do form manual)
  -- ----------------------------------------------------------
  v_sala_cod := public.gerar_codigo('salas');
  INSERT INTO public.salas (codigo, descricao, capacidade)
  VALUES (v_sala_cod, v_nome, v_est)
  RETURNING id INTO v_sala_id;

  -- ----------------------------------------------------------
  -- 2) Estantes (SEM corredor; sequencia POR SALA) ->
  --    3) Prateleiras -> 4) Caixas.
  --    O escopo da sequencia de estantes e so o id da sala
  --    (a antiga era "sala|corredor"; sem corredor, ficaria
  --    NULL na concatenacao - por isso usa o id da sala).
  --    O escopo da caixa tambem e o id da sala: o codigo e
  --    unico em toda a sala (CX-000001, CX-000002 ...), e nao
  --    reinicia em cada prateleira.
  -- ----------------------------------------------------------
  FOR j IN 1 .. v_est LOOP
    INSERT INTO public.estantes (codigo, sala_id, corredor_id, descricao, capacidade)
    VALUES (public.gerar_codigo('estantes', v_sala_id::text),
            v_sala_id, NULL, NULL, v_prat)
    RETURNING id INTO v_est_id;

    FOR k IN 1 .. v_prat LOOP
      INSERT INTO public.prateleiras (codigo, estante_id, descricao, capacidade)
      VALUES (public.gerar_codigo('prateleiras', v_est_id::text),
              v_est_id, NULL, v_cx)
      RETURNING id INTO v_prat_id;

      FOR m IN 1 .. v_cx LOOP
        INSERT INTO public.caixas (codigo, sala_id, estante_id, prateleira_id, descricao, capacidade)
        VALUES (public.gerar_codigo('caixas', v_sala_id::text),
                v_sala_id, v_est_id, v_prat_id, NULL, 5);
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'sala_id',      v_sala_id::text,
    'sala_codigo',  v_sala_cod,
    'estantes',     v_est,
    'prateleiras',  v_total_prat,
    'caixas',       v_total_cx
  );
END;
$$;

-- ------------------------------------------------------------
-- Permissoes: apenas usuarios autenticados (nao anon),
-- mesmo padrao do 13/14/15.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gerar_sala_arquivo(text, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_sala_arquivo(text, int, int, int) TO authenticated;

-- ------------------------------------------------------------
-- VERIFICACOES
--   SELECT public.gerar_sala_arquivo('Sala Sem Corredor', 6, 4, 3);
--     -> { "sala_id": "...", "sala_codigo": "SL-0xx",
--          "estantes": 6, "prateleiras": 24, "caixas": 72 }
--   SELECT codigo FROM public.salas ORDER BY codigo;
--   SELECT count(*) FROM public.corredores WHERE sala_id = '<sala_id>';
--     -- deve ser 0 (a sala gerada nao tem corredores)
--   SELECT count(*) FROM public.caixas;   -- subiu 72
--   SELECT codigo FROM public.caixas WHERE sala_id = '<sala_id>'
--   ORDER BY codigo;
--     -- sem repetidos: CX-000001, CX-000002 ... ate CX-000072
--     -- (a sequencia e POR SALA, nao reinicia na prateleira)
--
--   A funcao ANTIGA (5 argumentos) foi removida; se o front
--   ainda mandar p_corredores, o PostgREST responde 42883 e o
--   app orienta a rodar este script (recarregue com Ctrl+F5).
--
--   Apagar uma sala de teste (ordem das FKs):
--     DELETE FROM public.caixas      WHERE sala_id = '<sala_id>';
--     DELETE FROM public.prateleiras WHERE estante_id IN
--       (SELECT id FROM public.estantes  WHERE sala_id = '<sala_id>');
--     DELETE FROM public.estantes    WHERE sala_id = '<sala_id>';
--     DELETE FROM public.salas       WHERE id = '<sala_id>';
--     (sem DELETE em corredores: a sala gerada nao tem)
--     Depois rode de novo o 14_codigos_escopo_localizacoes.sql
--     para limpar os contadores de codigo orfaos (passo 5) e os
--     contadores de caixas (bloco da revisao "caixa por sala").
-- ------------------------------------------------------------
