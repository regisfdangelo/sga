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
--
-- POR QUE O "CODIGO TEMPORARIO"
-- ------------------------------------------------------------
-- O indice unico de caixas e (sala_id, codigo). Ao mover
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
-- 5) TRANSFERIR CAIXA (com os documentos que ela guarda) para
--    outra sala / estante / prateleira.
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

  -- Temporario (libera o codigo na sala de origem) + reserva do
  -- codigo final no destino; o unico UPDATE seguinte ja escreve
  -- codigo e sala juntos, entao nao ha estado intermediario.
  UPDATE public.caixas
     SET codigo = regexp_replace('~' || p_caixa_id::text, '[0-9]', 'D', 'g')
   WHERE id = p_caixa_id;

  v_novo := public.gerar_codigo('caixas', p_sala_id::text);

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

GRANT EXECUTE ON FUNCTION public.remover_caixa(public.caixas.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_prateleira(public.prateleiras.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_estante(public.estantes.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_estante(public.estantes.id%TYPE, public.salas.id%TYPE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_caixa(public.caixas.id%TYPE, public.salas.id%TYPE, public.estantes.id%TYPE, public.prateleiras.id%TYPE) TO authenticated;

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