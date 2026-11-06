-- ============================================================
-- SGA | 23_remover_sala.sql
-- Aba "Excluir Sala de Arquivo" (Cadastro, somente admin):
-- remove a SALA inteira com a estrutura dela em cascata.
--
--   remover_sala(p_sala_id)
--
-- REGRAS
-- ------------------------------------------------------------
-- 1) SOMENTE ADMIN: a funcao exige public.sga_perfil() = 'admin'
--    (mesma protecao das RPCs de usuarios, sql/03 e sql/06).
--    A tela ja esconde a aba dos demais perfis; aqui esta a
--    garantia no banco.
-- 2) BLOQUEIO POR PASTA DE DOCUMENTO: a funcao conta os
--    documentos das caixas da sala (documentos -> caixas ->
--    sala) e RECUSA a exclusao se houver qualquer um, dizendo
--    quantos. Documento descartado nao conta: o descarte tira o
--    caixa_id (sql/19), entao ele nao esta mais em nenhuma
--    caixa - o historico permanece e o descarte_sala_id vira
--    NULL (FK ON DELETE SET NULL, sql/19).
-- 3) CASCATA na ordem das FKs (mesma ordem manual ja documentada
--    em 15/16/17): caixas > prateleiras > estantes > corredores
--    > salas. estantes.corredor_id -> corredores -> salas e'
--    o que impoe a ordem.
--
-- Toda a exclusao (uma linha por tabela afetada) fica registrada
-- na auditoria pelo trigger trg_auditoria (sql/02; corredores em
-- sql/10).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: apos 22_telefone_emprestimo.sql.
-- Depois de rodar: recarregue o navegador (Ctrl+F5).
-- ============================================================


-- ============================================================
-- 1) REMOVER SALA (cascata em corredores, estantes, prateleiras
--    e caixas; recusa se houver pasta de documento)
-- ============================================================
CREATE OR REPLACE FUNCTION public.remover_sala(
  p_sala_id public.salas.id%TYPE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cod  text;
  v_docs bigint;
  v_corr int;
  v_est  int;
  v_prat int;
  v_cx   int;
BEGIN
  IF COALESCE(public.sga_perfil(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Somente administradores podem excluir salas de arquivo.';
  END IF;

  SELECT s.codigo INTO v_cod
    FROM public.salas s WHERE s.id = p_sala_id;
  IF v_cod IS NULL THEN
    RAISE EXCEPTION 'Sala nao encontrada.';
  END IF;

  -- Pastas de documento guardadas na sala. Qualquer status vale:
  -- se existe pasta com caixa na sala, a sala nao esta vazia.
  SELECT count(*) INTO v_docs
    FROM public.documentos d
    JOIN public.caixas c ON c.id = d.caixa_id
   WHERE c.sala_id = p_sala_id;

  IF v_docs > 0 THEN
    RAISE EXCEPTION
      'Nao e possivel remover a sala %: ela tem % pasta(s) de documento arquivado(s). '
      'Transfira ou exclua as pastas antes.',
      v_cod, v_docs;
  END IF;

  -- Contagens para o retorno (a tela mostra no toast de sucesso).
  SELECT count(*) INTO v_corr FROM public.corredores WHERE sala_id = p_sala_id;
  SELECT count(*) INTO v_est  FROM public.estantes   WHERE sala_id = p_sala_id;

  SELECT count(*) INTO v_prat
    FROM public.prateleiras p
    JOIN public.estantes e ON e.id = p.estante_id
   WHERE e.sala_id = p_sala_id;

  SELECT count(*) INTO v_cx FROM public.caixas WHERE sala_id = p_sala_id;

  -- Filho antes do pai (ordem das FKs).
  DELETE FROM public.caixas      WHERE sala_id = p_sala_id;
  DELETE FROM public.prateleiras WHERE estante_id IN (
    SELECT id FROM public.estantes WHERE sala_id = p_sala_id);
  DELETE FROM public.estantes    WHERE sala_id = p_sala_id;
  DELETE FROM public.corredores  WHERE sala_id = p_sala_id;
  DELETE FROM public.salas       WHERE id       = p_sala_id;

  RETURN jsonb_build_object(
    'codigo', v_cod,
    'corredores', v_corr,
    'estantes', v_est,
    'prateleiras', v_prat,
    'caixas', v_cx,
    'documentos', 0);
END;
$$;

-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.remover_sala(public.salas.id%TYPE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_sala(public.salas.id%TYPE) TO authenticated;

-- ------------------------------------------------------------
-- 2) VERIFICACAO
-- ------------------------------------------------------------
-- a) Funcao existe com a assinatura que o front chama
--    (p_sala_id uuid):
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'remover_sala';
--
-- b) Teste de BLOQUEIO (simula sessao de admin; no SQL Editor nao
--    ha JWT, por isso o BEGIN/ROLLBACK e o set local do uid):
--   BEGIN;
--   SELECT set_config('request.jwt.claim.sub', '<SEU_AUTH_UID>', true);
--   SELECT set_config('request.jwt.claim.role', 'authenticated', true);
--   SELECT public.remover_sala('<sala_com_pasta_id>');
--     -- ERROR: Nao e possivel remover a sala SL-00x: ela tem N
--     --        pasta(s) de documento arquivado(s)...
--   ROLLBACK;
--
-- c) Teste de SUCESSO (mesma sessao simulada, numa sala SEM
--    nenhuma pasta de documento):
--   BEGIN;
--   SELECT set_config('request.jwt.claim.sub', '<SEU_AUTH_UID>', true);
--   SELECT set_config('request.jwt.claim.role', 'authenticated', true);
--   SELECT public.remover_sala('<sala_vazia_id>');
--     -- {"codigo": "SL-00x", "estantes": ..., "caixas": ...}
--   SELECT count(*) FROM public.caixas     WHERE sala_id = '<sala_vazia_id>'; -- 0
--   SELECT count(*) FROM public.estantes   WHERE sala_id = '<sala_vazia_id>'; -- 0
--   SELECT count(*) FROM public.salas      WHERE id       = '<sala_vazia_id>'; -- 0
--   ROLLBACK;
--
-- d) Teste de PERMISSAO (perfil arquivista -> recusa):
--   SELECT public.remover_sala('<qualquer sala_id>');
--     -- ERROR: Somente administradores podem excluir salas de arquivo.
--
-- e) Auditoria da exclusao (log DELETE por tabela):
--   SELECT tabela, acao, dados_antes->>'codigo' AS codigo, criado_em
--     FROM public.auditoria
--    WHERE acao = 'DELETE' AND tabela IN ('salas','estantes','corredores')
--    ORDER BY criado_em DESC LIMIT 10;
--
-- Se o front disser "RPC ausente", a assinatura nao bateu:
-- confira com
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'remover_sala';
-- tem de aparecer remover_sala(p_sala_id uuid); se nao aparecer,
-- rode este arquivo de novo.
-- ------------------------------------------------------------
