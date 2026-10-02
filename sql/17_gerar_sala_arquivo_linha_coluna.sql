-- ============================================================
-- SGA | 17_gerar_sala_arquivo_linha_coluna.sql
-- Aba "Gerar Sala de Arquivo" (Cadastro > Salas de Arquivo):
-- campos LINHA e COLUNA — a planta da sala.
--
-- O usuario informa quantas LINHAS e quantas COLUNAS a sala tem
-- e as estantes passam a ser distribuidas nessa grade (da esquerda
-- para a direita, de cima para baixo):
--
--   linha 1:  E-001  E-002  E-003
--   linha 2:  E-004  E-005  E-006
--   linha 3:  E-007  E-008  E-009
--
-- A quantidade de estantes continua livre (como no 16): ela e
-- usada como quantidade TOTAL, e a grade recebe as estantes
-- ate o limite de (linhas x colunas) — as posicoes sobrando
-- ficam vazias na planta do mapa do Painel. Se a quantidade de
-- estantes for MAIOR que a grade, a funcao recusa e diz ate
-- quantas cabem.
--
-- Colunas novas (integer, nullable):
--   public.salas.linha / public.salas.coluna
--       -> as dimensoes da SALA (linhas x colunas).
--   public.estantes.linha / public.estantes.coluna
--       -> a POSICAO de cada estante dentro da grade (1..linhas,
--          1..colunas).
--   Salas/estantes antigas ficam com linha/coluna NULL e o mapa
--   continua estimando a grade automaticamente (nada quebra).
--
-- Estrutura gerada (mesma do 16):
--   Sala        -> SL-001 (sequencia global)
--   Estantes    -> quantidade LIVRE (sequencia POR SALA,
--                  corredor_id NULL — a sala nao tem corredor)
--   Prateleiras -> P-0001 ...             (sequencia POR ESTANTE)
--   Caixas      -> CX-000001 ..           (sequencia POR SALA)
--
-- Todos os codigos sao reservados pela MESMA funcao gerar_codigo()
-- do cadastro manual (sql/13 + sql/14), com o escopo de cada
-- nivel — por isso os codigos sao identicos aos do cadastro um a
-- um.
--
-- Limites validados ANTES de qualquer INSERT:
--   linhas   -> 1 a 100        colunas -> 1 a 100
--   estantes -> 1 a (linhas x colunas) e a 10000
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
-- ATENCAO: a assinatura da funcao MUDOU (6 argumentos). Este
-- script da DROP na de 5 argumentos (do 15) e na de 4 (do 16) e
-- cria a nova. Depois de rodar, recarregue o navegador (Ctrl+F5).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 16_gerar_sala_arquivo_sem_corredores.sql.
--
-- PARA ZERAR E TESTAR A NOVA GERACAO:
--   1) rode ESTE script (17) primeiro;
--   2) limpe os dados de teste com 11_apagar_dados_teste.sql
--      (ele zera TAMBEM o public.codigo_sequencia, entao a nova
--      sala recomeca em SL-001 e as estantes em E-001);
--   3) recarregue a pagina (Ctrl+F5) para o front buscar as
--      colunas novas;
--   4) Cadastro > Salas de Arquivo > Gerar Sala de Arquivo.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Colunas linha/coluna (nullable: o cadastro manual nao
--    preenche, e salas antigas continuam sem posicao)
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['salas', 'estantes'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabela inexistente, ignorada: public.%', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS linha integer', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS coluna integer', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2) Funcoes antigas (5 args do 15, 4 args do 16): fora.
--    DROP e idempotente — so remove se existir.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.gerar_sala_arquivo(text, int, int, int, int);
DROP FUNCTION IF EXISTS public.gerar_sala_arquivo(text, int, int, int);

-- ------------------------------------------------------------
-- 3) RPC: sala + grade de estantes + prateleiras + caixas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_sala_arquivo(
  p_nome        text,
  p_estantes    int,
  p_prateleiras int,
  p_caixas      int,
  p_linhas      int,
  p_colunas     int
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
  v_linhas     int  := coalesce(p_linhas, 0);
  v_colunas    int  := coalesce(p_colunas, 0);
  v_capacidade int;
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
  IF v_linhas < 1 OR v_linhas > 100 THEN
    RAISE EXCEPTION 'Quantidade de linhas invalida: use 1 a 100.';
  END IF;
  IF v_colunas < 1 OR v_colunas > 100 THEN
    RAISE EXCEPTION 'Quantidade de colunas invalida: use 1 a 100.';
  END IF;
  IF v_est < 1 THEN
    RAISE EXCEPTION 'Informe a quantidade de estantes (minimo 1).';
  END IF;

  -- A grade comporta exatamente (linhas x colunas) estantes.
  v_capacidade := v_linhas * v_colunas;

  IF v_est > v_capacidade THEN
    RAISE EXCEPTION 'A grade % linha(s) x % coluna(s) comporta no maximo % estante(s) (informado: %).',
      v_linhas, v_colunas, v_capacidade, v_est;
  END IF;
  IF v_est > 10000 THEN
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
  --    capacidade = nº de estantes; linha/coluna = a grade.
  -- ----------------------------------------------------------
  v_sala_cod := public.gerar_codigo('salas');
  INSERT INTO public.salas (codigo, descricao, capacidade, linha, coluna)
  VALUES (v_sala_cod, v_nome, v_est, v_linhas, v_colunas)
  RETURNING id INTO v_sala_id;

  -- ----------------------------------------------------------
  -- 2) Estantes na GRADE (SEM corredor; sequencia POR SALA) ->
  --    3) Prateleiras -> 4) Caixas.
  --    A posicao e calculada em leitura de grade: a estante j
  --    ocupa a linha ((j - 1) / v_colunas) + 1 e a coluna
  --    ((j - 1) % v_colunas) + 1.
  --
  --    O escopo da sequencia de estantes e so o id da sala
  --    (a antiga era "sala|corredor"; sem corredor, ficaria
  --    NULL na concatenacao - por isso usa o id da sala).
  --    O escopo da caixa tambem e o id da sala: o codigo e
  --    unico em toda a sala (CX-000001, CX-000002 ...), e nao
  --    reinicia em cada prateleira.
  -- ----------------------------------------------------------
  FOR j IN 1 .. v_est LOOP
    INSERT INTO public.estantes
      (codigo, sala_id, corredor_id, descricao, capacidade, linha, coluna)
    VALUES (public.gerar_codigo('estantes', v_sala_id::text),
            v_sala_id, NULL, NULL, v_prat,
            ((j - 1) / v_colunas) + 1,
            ((j - 1) % v_colunas) + 1)
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
    'caixas',       v_total_cx,
    'linhas',       v_linhas,
    'colunas',      v_colunas
  );
END;
$$;

-- ------------------------------------------------------------
-- Permissoes: apenas usuarios autenticados (nao anon),
-- mesmo padrao do 13/14/15/16.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gerar_sala_arquivo(text, int, int, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_sala_arquivo(text, int, int, int, int, int) TO authenticated;

-- ------------------------------------------------------------
-- VERIFICACOES
--   -- 18 estantes numa grade 3 x 6 (3 linhas de 6):
--   SELECT public.gerar_sala_arquivo('Sala Grade', 18, 4, 2, 3, 6);
--     -> { "sala_id": "...", "sala_codigo": "SL-0xx",
--          "estantes": 18, "prateleiras": 72, "caixas": 144,
--          "linhas": 3, "colunas": 6 }
--
--   -- as estantes ocupam a grade, de cima para baixo:
--   SELECT linha, coluna, codigo
--     FROM public.estantes WHERE sala_id = '<sala_id>'
--    ORDER BY linha, coluna;
--     -- linha 1: E-001..E-006 | linha 2: E-007..E-012
--     -- linha 3: E-013..E-018
--
--   -- a sala guarda a grade:
--   SELECT codigo, linha, coluna, capacidade
--     FROM public.salas WHERE id = '<sala_id>';
--
--   -- grade pequena demais para as estantes (recusa):
--   SELECT public.gerar_sala_arquivo('Sala pequena', 10, 4, 2, 2, 3);
--     -- ERROR: A grade 2 linha(s) x 3 coluna(s) comporta no maximo
--     --        6 estante(s) (informado: 10).
--
--   -- grade maior que as estantes (deixa posicao vazia):
--   SELECT public.gerar_sala_arquivo('Sala com folga', 4, 4, 2, 3, 3);
--     -- 4 estantes no canto superior esquerdo de uma grade 3x3
--
--   A funcao ANTIGA (4 argumentos do 16) foi removida; se o front
--   ainda mandar 4 argumentos, o PostgREST responde 42883 e o app
--   orienta a rodar este script (recarregue com Ctrl+F5).
--
--   Apagar uma sala de teste (ordem das FKs):
--     DELETE FROM public.caixas      WHERE sala_id = '<sala_id>';
--     DELETE FROM public.prateleiras WHERE estante_id IN
--       (SELECT id FROM public.estantes  WHERE sala_id = '<sala_id>');
--     DELETE FROM public.estantes    WHERE sala_id = '<sala_id>';
--     DELETE FROM public.salas       WHERE id = '<sala_id>';
--     Depois rode de novo o 14_codigos_escopo_localizacoes.sql
--     para limpar os contadores de codigo orfaos.
-- ------------------------------------------------------------