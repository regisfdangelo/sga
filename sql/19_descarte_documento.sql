-- ============================================================
-- SGA | 19_descarte_documento.sql
-- Data do descarte + acao "Descartar" (tela Temporalidade).
--
-- PARA QUE SERVE
-- ------------------------------------------------------------
-- O grafico de colunas do Painel ("documentos novos x descartados
-- por mes") precisa da DATA em que o documento foi descartado.
-- Ate aqui a tabela public.documentos nao tinha essa coluna: o
-- status 'descartado' existia, mas nao ha quando ele aconteceu,
-- e nenhuma tela do sistema marcava o descarte (so 'disponivel'
-- e 'emprestado' eram gravados pelo app).
--
-- O QUE ESTE ARQUIVO FAZ
-- ------------------------------------------------------------
-- 1) Cria a coluna documentos.descartado_em (timestamptz,
--    nullable). NULL = documento nunca descartado.
-- 2) Backfill: documentos JA com status 'descartado' recebem
--    updated_at (ou created_at) como data do descarte, para o
--    historico existente nao sumir do grafico.
-- 3) Trigger: sempre que o status virar 'descartado', preenche
--    descartado_em = now(); se o status sair de 'descartado'
--    (documento volta ao acervo), limpa a coluna.
--    Sem isso, a data dependeria de o front lembrar de enviar o
--    campo - e qualquer UPDATE direto deixaria o grafico errado.
-- 4) RPC descartar_documento(p_documento_id, p_confirmar):
--    marca o descarte em transacao e RECUSA quando o documento
--    esta emprestado (devolva antes) ou ja foi descartado.
-- 5) Log de auditoria com acao 'DESCARTE': quem descartou (usuario
--    logado), data e hora do descarte. Ver secao 5 abaixo.
--
-- REGRAS
-- ------------------------------------------------------------
-- - Idempotente: pode ser executar mais de uma vez.
-- - O trigger e BEFORE UPDATE OF status, entao so grava quando o
--   status muda de fato (nao a cada edicao de descricao).
-- - A RPC e SECURITY DEFINER: assim o log 'DESCARTE' e' garantido
--   (a funcao de auditoria e' chamada so por ela) e a validacao do
--   prazo continua no servidor. As policies de documentos sao
--   USING (true) para authenticated (sql/04), entao nada se perde
--   em restricao. REVOKE de PUBLIC/anon e GRANT para
--   authenticated, mesmo padrao do 13/14/16/17/18.
-- - A auditoria do descarte fica numa funcao SEPARADA e SECURITY
--   DEFINER (como registrar_evento_auth, do sql/05), porque o
--   INSERT direto em auditoria foi revogado do papel
--   authenticated. A identidade (usuario_id/e-mail/perfil) e
--   lida do banco via auth.uid() - NUNCA enviada pelo cliente,
--   senao o log seria forjavel. Sem usuario autenticado o
--   descarte e' cancelado por exception (nada de descarte sem
--   log).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Ordem: apos 18_editar_sala_arquivo.sql.
-- Depois de rodar: recarregue o navegador (Ctrl+F5).
-- ============================================================


-- ============================================================
-- 1) COLUNA
-- ============================================================
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS descartado_em timestamptz;

COMMENT ON COLUMN public.documentos.descartado_em IS
  'Data/hora do descarte do documento (NULL = nunca descartado). Preenchida pelo trigger trg_documentos_descarte.';


-- ============================================================
-- 2) BACKFILL dos documentos ja descartados
-- ============================================================
UPDATE public.documentos
   SET descartado_em = COALESCE(updated_at, created_at)
 WHERE status = 'descartado'
   AND descartado_em IS NULL;


-- ============================================================
-- 3) TRIGGER: status -> 'descartado' preenche a data
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_documentos_descarte() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'descartado' THEN
      -- NULL se ja foi descartado antes (nao sobrescreve a data real)
      NEW.descartado_em := COALESCE(NEW.descartado_em, now());
    ELSE
      -- voltou para o acervo: a data do descarte deixa de valer
      NEW.descartado_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentos_descarte ON public.documentos;

CREATE TRIGGER trg_documentos_descarte
  BEFORE UPDATE OF status ON public.documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_documentos_descarte();


-- ============================================================
-- 4) RPC: DESCARTAR DOCUMENTO
-- ============================================================
-- Passa por RPC (e nao por UPDATE direto) porque a regra precisa
-- ser garantida no servidor: emprestado nao se descarta, e ja
-- descartado nao e descartado de novo (o grafico contaria duas
-- vezes no mesmo mes).
CREATE OR REPLACE FUNCTION public.descartar_documento(
  p_documento_id public.documentos.id%TYPE,
  p_confirmar     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc     public.documentos%ROWTYPE;
  v_dias    int;
  v_clientes int;
  v_antes   jsonb;
BEGIN
  SELECT * INTO v_doc
    FROM public.documentos d
   WHERE d.id = p_documento_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento nao encontrado.';
  END IF;

  IF v_doc.status = 'descartado' THEN
    RAISE EXCEPTION 'O documento % ja foi descartado.', v_doc.protocolo;
  END IF;

  IF v_doc.status = 'emprestado' THEN
    SELECT count(*) INTO v_clientes
      FROM public.emprestimos e
     WHERE e.documento_id = p_documento_id
       AND e.status = 'ativo';
    IF v_clientes > 0 THEN
      RAISE EXCEPTION
        'O documento % esta emprestado (% emprestimo(s) ativo(s)). '
        'Registre a devolucao antes de descartar.', v_doc.protocolo, v_clientes;
    END IF;
  END IF;

  -- So descarta documento com prazo de guarda vencido. p_confirmar
  -- permite a excecao deliberada (o arquivista assume a decisao).
  IF v_doc.prazo_guarda IS NULL THEN
    IF NOT p_confirmar THEN
      RAISE EXCEPTION
        'O documento % nao tem prazo de guarda definido. '
        'Confirme o descarte se quiser prosseguir.', v_doc.protocolo;
    END IF;
  ELSE
    -- ::date no meio porque a coluna pode ser date OU timestamptz:
    -- CURRENT_DATE - timestamptz devolve interval e o ::int estouraria.
    v_dias := (CURRENT_DATE - v_doc.prazo_guarda::date)::int;
    IF v_dias < 0 AND NOT p_confirmar THEN
      RAISE EXCEPTION
        'O prazo de guarda do documento % vence em % dia(s). '
        'Confirme o descarte se quiser prosseguir.',
        v_doc.protocolo, -v_dias;
    END IF;
  END IF;

  -- Foto do estado ANTES, capturada aqui: depois do UPDATE a linha
  -- ja esta 'descartado' e o "antes" seria mentira.
  v_antes := jsonb_build_object(
    'status',       v_doc.status,
    'protocolo',    v_doc.protocolo,
    'setor',        v_doc.setor,
    'caixa_id',     v_doc.caixa_id,
    'prazo_guarda', v_doc.prazo_guarda,
    'descartado_em', v_doc.descartado_em
  );

  UPDATE public.documentos
     SET status = 'descartado'
   WHERE id = p_documento_id;

  -- Log de auditoria dedicado ('DESCARTE'). O UPDATE acima JA gera
  -- uma linha 'UPDATE' pelo trigger trg_auditoria (sql/02), mas ela
  -- nao diz POR QUE: aqui fica registrado quem descartou, quando e
  -- com qual prazo de guarda.
  PERFORM public.fn_auditar_descarte(p_documento_id, v_antes, p_confirmar);

  RETURN jsonb_build_object(
    'id',             v_doc.id,
    'protocolo',      v_doc.protocolo,
    'descartado_em',  now(),
    'prazo_guarda',   v_doc.prazo_guarda
  );
END;
$$;

REVOKE ALL ON FUNCTION public.descartar_documento(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.descartar_documento(uuid, boolean) TO authenticated;


-- ============================================================
-- 5) AUDITORIA DO DESCARTE
-- ------------------------------------------------------------
-- Objetivo: um log com o nome "DESCARTE" que registre
--   - QUEM descartou  -> usuario_id / usuario_email / usuario_perfil
--                        lidos do banco (auth.uid()), nunca do cliente
--   - QUANDO           -> criado_em (default now()) e
--                        dados_depois.descartado_em (o trigger)
--   - O QUE            -> protocolo, prazo de guarda, status de
--                        partida e se houve confirmacao para
--                        descartar antes do prazo
--
-- Por que uma funcao a parte e nao um INSERT dentro da RPC?
--   O sql/05 revogou o INSERT em auditoria do papel authenticated
--   (para o log nao ser forjavel). Esta funcao e SECURITY DEFINER,
--   igual a registrar_evento_auth: grava no log com a identidade
--   REAL.
--
-- Onde o "antes" vem?
--   Da propria RPC, lido ANTES do UPDATE (v_antes). Ler depois
--   daria "descartado" dos dois lados e o log nao diria nada.
--
-- Por que o CHECK precisa ser alterado?
--   A coluna auditoria.acao tem CHECK (acao IN ('INSERT','UPDATE',
--   'DELETE','LOGIN','LOGOUT')). Sem incluir 'DESCARTE' o INSERT
--   seria recusado. O CHECK e recriado com o mesmo conjunto + a
--   nova acao (nada e removido, entao nada quebra).
--
-- Por que a funcao NAO pode ser chamada pelo usuario?
--   Ela aceita o "antes" e a confirmacao como parametro, entao
--   qualquer um poderia registrar um 'DESCARTE' falso. Por isso o
--   EXECUTE fica com o dono da funcao (so a RPC, que e SECURITY
--   DEFINER, alcanca) e o prototipo/protocolo sao lidos do banco,
--   nunca recebidos como texto do chamador.
-- ============================================================
ALTER TABLE public.auditoria
  DROP CONSTRAINT IF EXISTS auditoria_acao_check;

ALTER TABLE public.auditoria
  ADD CONSTRAINT auditoria_acao_check
  CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'DESCARTE'));


-- Prototipo antigo (aceitava protocolo/prazo do chamador): sai de cena.
DROP FUNCTION IF EXISTS public.fn_auditar_descarte(uuid, text, date, boolean);

CREATE OR REPLACE FUNCTION public.fn_auditar_descarte(
  p_registro_id  uuid,
  p_antes        jsonb,
  p_confirmado   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario public.usuarios%ROWTYPE;
  v_doc     public.documentos%ROWTYPE;
BEGIN
  -- Identidade real: so grava se o descarte vier de uma sessao
  -- autenticada com linha em public.usuarios. Sem usuario nao ha
  -- descarte: a exception desfaz tudo (nada de descarte sem log).
  SELECT * INTO v_usuario
    FROM public.usuarios
   WHERE id = auth.uid();

  IF v_usuario.id IS NULL THEN
    RAISE EXCEPTION
      'Descarte sem sessao autenticada valida: nada foi registrado em auditoria.';
  END IF;

  -- Confere que o documento ESTA descartado de verdade. Sem isso a
  -- funcao criaria um 'DESCARTE' para um documento no acervo.
  SELECT * INTO v_doc
    FROM public.documentos
   WHERE id = p_registro_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento % nao existe: auditoria nao registrada.', p_registro_id;
  END IF;

  IF v_doc.status <> 'descartado' THEN
    RAISE EXCEPTION
      'Documento % esta com status %: nao e um descarte.',
      v_doc.protocolo, v_doc.status;
  END IF;

  -- "antes": vem da RPC (que leu a linha antes do UPDATE).
  -- "depois": lido do banco agora, com a data real do descarte.
  INSERT INTO public.auditoria
    (usuario_id, usuario_email, usuario_perfil, tabela, acao,
     registro_id, dados_antes, dados_depois)
  VALUES
    (v_usuario.id, v_usuario.email, v_usuario.perfil,
     'documentos', 'DESCARTE', p_registro_id::text,
     COALESCE(p_antes, '{}'::jsonb),
     jsonb_build_object(
       'status',         'descartado',
       'descartado_em',  v_doc.descartado_em,
       'protocolo',      v_doc.protocolo,
       'prazo_guarda',   v_doc.prazo_guarda,
       'confirmacao',    COALESCE(p_confirmado, false)
     ));
END;
$$;

-- Sem GRANT para authenticated: o log de descarte so nasce da RPC.
REVOKE ALL ON FUNCTION public.fn_auditar_descarte(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 6) INDICE para o grafico mensal (descartado_em por mes)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_documentos_descartado_em
  ON public.documentos (descartado_em)
  WHERE descartado_em IS NOT NULL;


-- ============================================================
-- VERIFICACAO
-- ------------------------------------------------------------
-- a) coluna existe (esperado: descartado_em | timestamptz)
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'documentos'
   AND column_name = 'descartado_em';
-- b) trigger criado
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'public.documentos'::regclass
--    AND NOT tgisinternal;
-- c) RPC com 2 parametros, SECURITY DEFINER, sem acesso anon/public
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'descartar_documento';
-- d) a funcao de auditoria NAO pode ser chamada pelo usuario:
--    (prosecdef = true e nenhum EXECUTE para authenticated)
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS user_chama
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'fn_auditar_descarte';
--    esperado: user_chama = false
-- e) documento de teste: descartar -> status/descartado_em
-- SELECT protocolo, status, descartado_em FROM public.documentos
--  WHERE status = 'descartado' ORDER BY descartado_em DESC LIMIT 10;
-- f) o log do descarte
-- SELECT criado_em, usuario_email, usuario_perfil,
--        dados_antes->>'status' AS antes,
--        dados_depois->>'descartado_em' AS descartado_em,
--        dados_depois->>'confirmacao' AS confirmacao
--   FROM public.auditoria
--  WHERE acao = 'DESCARTE'
--  ORDER BY criado_em DESC LIMIT 10;
-- ============================================================