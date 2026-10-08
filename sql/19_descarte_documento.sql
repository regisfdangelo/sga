-- ============================================================
-- SGA | 19_descarte_documento.sql
-- Data do descarte + acao "Descartar" (tela Temporalidade).
--
-- PARA QUE SERVE
-- ------------------------------------------------------------
-- O grafico de LINHAS do Painel ("movimentacao da sala, dia a dia")
-- precisa da DATA em que o documento foi descartado e da SALA de
-- onde ele saiu (o descarte zera o caixa_id, o unico vinculo com a
-- sala).
-- Ate aqui a tabela public.documentos nao tinha essa coluna: o
-- status 'descartado' existia, mas nao ha quando ele aconteceu,
-- e nenhuma tela do sistema marcava o descarte (so 'disponivel'
-- e 'emprestado' eram gravados pelo app).
--
-- O QUE ESTE ARQUIVO FAZ
-- ------------------------------------------------------------
-- 1) Cria as colunas de historico do descarte: documentos.descartado_em
--    (timestamptz, NULL = nunca descartado) e documentos.descarte_sala_id
--    (uuid) - guarda de QUAL SALA a pasta foi descartada, sem o qual o
--    grafico do Painel nao teria como contar "descartados" da sala, ja
--    que o caixa_id (unico link caixa->sala) zera no descarte.
-- 2) Backfill: documentos JA com status 'descartado' recebem
--    updated_at (ou created_at) como data do descarte, a SALA de
--    onde sairam (lida da caixa, ou do log de auditoria quando uma
--    rodada anterior ja tinha zerado o caixa_id) e saem da caixa
--    em que ainda estavam (caixa_id = NULL).
-- 3) Trigger: sempre que o status virar 'descartado', preenche
--    descartado_em = now(), guarda a sala da caixa em
--    descarte_sala_id e tira a pasta da caixa (caixa_id := NULL,
--    INSERT ou UPDATE, venha de onde vier); se o status sair de
--    'descartado' (documento volta ao acervo), limpa as duas.
--    Sem isso, data e sala dependeriam de o front lembrar de enviar
--    os campos - e qualquer UPDATE direto deixaria o grafico errado.
-- 4) RPC descartar_documento(p_documento_id, p_confirmar):
--    marca o descarte em transacao, RETIRA o documento da caixa
--    (caixa_id = NULL) e RECUSA quando o documento esta
--    emprestado (devolva antes) ou ja foi descartado.
-- 5) Log de auditoria com acao 'DESCARTE': quem descartou (usuario
--    logado), data e hora do descarte. Ver secao 5 abaixo.
-- 6) Indice parcial em descartado_em (base da serie diaria do grafico).
--
-- REGRAS
-- ------------------------------------------------------------
-- - Descartado NAO fica guardado em caixa nenhuma: enquanto o
--   status for 'descartado', documentos.caixa_id e' NULL (trigger
--   + RPC + backfill). Assim a pasta/ja descartada sai da caixa,
--   some da sala do arquivo (mapa, arvore, ocupacao e busca por
--   sala) e devolve a vaga que ocupava. O HISTORICO permanece:
--   - auditoria 'DESCARTE' guarda quem/quando, o prazo e a
--     localizacao ANTERIOR (caixa_id + localizacao legivel);
--   - trg_auditoria guarda a linha inteira de antes e de depois;
--   - documentos.descarte_sala_id guarda a SALA do descarte (e' o
--     que o grafico do Painel usa para contar "descartados" da
--     sala, depois que o caixa_id zera);
--   - a propria linha do documento continua existindo com status
--     'descartado' (e' o que a Temporalidade/Pesquisa mostram).
-- - Idempotente: pode ser executar mais de uma vez.
-- - O trigger roda a cada INSERT/UPDATE, mas descartado_em e
--   descarte_sala_id so mudam quando o status muda de fato (nao a
--   cada edicao de descricao); a limpeza de caixa_id e' sempre
--   aplicada.
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
-- 1) COLUNAS (data e sala do descarte)
-- ============================================================
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS descartado_em timestamptz;

COMMENT ON COLUMN public.documentos.descartado_em IS
  'Data/hora do descarte do documento (NULL = nunca descartado). Preenchida pelo trigger trg_documentos_descarte.';

-- documentos.caixa_id precisa aceitar NULL: e' exatamente o estado
-- de um documento descartado (fora de qualquer caixa) e o front ja
-- trata a pasta "sem caixa localizada". Sem isto o backfill de baixo
-- falharia e o trigger do descarte nao conseguiria tirar a pasta.
ALTER TABLE public.documentos ALTER COLUMN caixa_id DROP NOT NULL;

-- HISTORICO: de QUAL SALA o documento foi descartado. Zerado o
-- caixa_id no descarte, sem esta coluna nao ha como atribuir o
-- descarte a uma sala (a serie "descartados" do grafico do Painel
-- ficaria sempre zerada, ja que o vinculo caixa->sala sumiu).
-- Guarda a sala da caixa NO MOMENTO do descarte e volta a NULL
-- quando o documento e' devolvido ao acervo.
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS descarte_sala_id uuid
  REFERENCES public.salas (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.documentos.descarte_sala_id IS
  'Historico: sala de onde o documento foi descartado (NULL = nao descartado, ou devolvido ao acervo).';


-- ============================================================
-- 2) BACKFILL dos documentos ja descartados
-- ------------------------------------------------------------
-- Ordem IMPORTANTE: a SALA e capturada ANTES de qualquer outro
-- UPDATE. Numa base que ja rodou a versao anterior do sql/19 o
-- trigger ja existe e zera o caixa_id no primeiro UPDATE na linha
-- (e na base ja migrada ele ja esta zerado): depois disso nao ha
-- como saber a sala lendo a propria linha.
-- ============================================================

-- 2a) A sala sai da caixa em que o descartado ainda esta' guardado
--     (ou estava, numa base que nunca migrou).
UPDATE public.documentos d
   SET descarte_sala_id = c.sala_id
  FROM public.caixas c
 WHERE d.caixa_id = c.id
   AND d.status = 'descartado'
   AND d.descarte_sala_id IS NULL;

-- 2b) Recuperacao de quem JA perdeu o caixa_id (rodada anterior do
--     sql/19): a sala sai do log de auditoria, que guarda a linha
--     ANTES do UPDATE (dados_antes.caixa_id). Comparacao em texto
--     para nao depender de cast de uuid invalido; so mexe em
--     descartado que ainda nao tem sala registrada.
UPDATE public.documentos d
   SET descarte_sala_id = c.sala_id
  FROM public.auditoria a
  JOIN public.caixas c
    ON c.id::text = a.dados_antes->>'caixa_id'
 WHERE a.tabela = 'documentos'
   AND a.acao IN ('UPDATE', 'DESCARTE')
   AND a.registro_id = d.id::text
   AND a.dados_antes->>'caixa_id' IS NOT NULL
   AND a.dados_depois->>'caixa_id' IS NULL
   AND d.status = 'descartado'
   AND d.descarte_sala_id IS NULL;

-- 2c) Data do descarte dos documentos JA marcados.
UPDATE public.documentos
   SET descartado_em = COALESCE(updated_at, created_at)
 WHERE status = 'descartado'
   AND descartado_em IS NULL;

-- 2d) Documentos descartados ANTES desta regra ainda apontavam para
--     a caixa em que estavam guardados: tiralos de la e o que faz a
--     pasta deixar de constar na sala do arquivo. O UPDATE e' logado
--     por trg_auditoria (sql/02) com o caixa_id antigo em
--     dados_antes, entao a localizacao anterior nao se perde.
UPDATE public.documentos
   SET caixa_id = NULL
 WHERE status = 'descartado'
   AND caixa_id IS NOT NULL;


-- ============================================================
-- 3) TRIGGER: status -> 'descartado' preenche a data, GUARDA a
--    sala da caixa e TIRA a pasta da caixa (descartado nao e'
--    guardado em lugar nenhum)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_documentos_descarte() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caixa public.caixas.id%TYPE;
BEGIN
  -- Regra do acervo: enquanto a linha for 'descartado', ela NAO
  -- tem caixa. Vale para INSERT (inclusao/importacao direta) e
  -- para QUALQUER UPDATE (RPC descartar_documento ou UPDATE
  -- direto no PostgREST): caixa_id vai para NULL, a vaga da
  -- caixa e' liberada e a pasta sai da sala do arquivo. A
  -- localizacao anterior fica no historico (auditoria).
  IF NEW.status = 'descartado' THEN
    -- A caixa da pasta e' a de ANTES (a mesma linha pode estar
    -- limpando o caixa_id junto). Dessa caixa nasce a SALA que
    -- fica guardada em descarte_sala_id: com o caixa_id zerado
    -- e' a unica pista de sala que o grafico do Painel tem para
    -- contar os descartados da sala. Guarda-se ANTES de zerar.
    IF NEW.descarte_sala_id IS NULL THEN
      IF TG_OP = 'UPDATE' THEN
        v_caixa := COALESCE(NEW.caixa_id, OLD.caixa_id);
      ELSE
        v_caixa := NEW.caixa_id;
      END IF;

      IF v_caixa IS NOT NULL THEN
        SELECT cx.sala_id
          INTO NEW.descarte_sala_id
          FROM public.caixas cx
         WHERE cx.id = v_caixa;
      END IF;
    END IF;

    NEW.caixa_id := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'descartado' THEN
      -- NULL se ja veio com data (importacao); senao, agora
      NEW.descartado_em := COALESCE(NEW.descartado_em, now());
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'descartado' THEN
      -- NULL se ja foi descartado antes (nao sobrescreve a data real)
      NEW.descartado_em := COALESCE(NEW.descartado_em, now());
    ELSE
      -- voltou para o acervo: a data e a sala do descarte deixam
      -- de valer (a pasta volta a ser atribuida pela caixa)
      NEW.descartado_em := NULL;
      NEW.descarte_sala_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documentos_descarte ON public.documentos;

-- BEFORE UPDATE (sem a clausula OF status) de proposito: a
-- parte do caixa_id precisa valer tambem quando um update nao
-- mexe no status - senao um descartado voltaria para a caixa.
CREATE TRIGGER trg_documentos_descarte
  BEFORE INSERT OR UPDATE ON public.documentos
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
  v_local   text;
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

  -- Localizacao legivel da caixa que o documento ocupava: ela
  -- sai daqui para o historico (o caixa_id vira NULL em seguida).
  SELECT concat_ws(' / ', cx.codigo, s.codigo, e.codigo, p.codigo)
    INTO v_local
    FROM public.caixas cx
    LEFT JOIN public.salas s       ON s.id = cx.sala_id
    LEFT JOIN public.estantes e    ON e.id = cx.estante_id
    LEFT JOIN public.prateleiras p ON p.id = cx.prateleira_id
   WHERE cx.id = v_doc.caixa_id;

  -- Foto do estado ANTES, capturada aqui: depois do UPDATE a linha
  -- ja esta 'descartado' e o "antes" seria mentira.
  v_antes := jsonb_build_object(
    'status',       v_doc.status,
    'protocolo',    v_doc.protocolo,
    'setor',        v_doc.setor,
    'caixa_id',     v_doc.caixa_id,
    'localizacao',  v_local,
    'prazo_guarda', v_doc.prazo_guarda,
    'descartado_em', v_doc.descartado_em
  );

  -- Descarte: sai do acervo E da caixa. caixa_id = NULL e' o que
  -- faz a pasta deixar de constar na sala do arquivo (mapa,
  -- arvore, ocupacao e busca por sala) e liberar a vaga; a
  -- localizacao de antes continua no historico (v_antes acima) e a
  -- SALA da caixa e' guardada pelo trigger em descarte_sala_id
  -- (historico que o grafico do Painel usa por sala).
  UPDATE public.documentos
     SET status   = 'descartado',
         caixa_id = NULL
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
--                        partida, a localizacao ANTERIOR (caixa
--                        em que estava, dados_antes.localizacao)
--                        e se houve confirmacao para descartar
--                        antes do prazo
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
       -- NULL = a pasta ja nao esta guardada em nenhuma caixa
       -- (a de antes esta em dados_antes.caixa_id/.localizacao).
       'caixa_id',       v_doc.caixa_id,
       'confirmacao',    COALESCE(p_confirmado, false)
     ));
END;
$$;

-- Sem GRANT para authenticated: o log de descarte so nasce da RPC.
REVOKE ALL ON FUNCTION public.fn_auditar_descarte(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 6) INDICE para a serie diaria do grafico (descartado_em por dia)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_documentos_descartado_em
  ON public.documentos (descartado_em)
  WHERE descartado_em IS NOT NULL;


-- ============================================================
-- VERIFICACAO
-- ------------------------------------------------------------
-- a) colunas existem (esperado: descartado_em | timestamptz e
--    descarte_sala_id | uuid)
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'documentos'
   AND column_name IN ('descartado_em', 'descarte_sala_id')
 ORDER BY column_name;
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
-- e) documento de teste: descartar -> status/descartado_em,
--    descarte_sala_id (sala de origem) e caixa_id NULL
-- SELECT protocolo, status, descartado_em, descarte_sala_id, caixa_id
--   FROM public.documentos
--  WHERE status = 'descartado' ORDER BY descartado_em DESC LIMIT 10;
-- f) NENHUM descartado pode continuar em caixa (esperado: 0)
SELECT count(*) AS descartados_em_caixa
  FROM public.documentos
 WHERE status = 'descartado' AND caixa_id IS NOT NULL;
-- h) descartados SEM sala registrada (esperado: 0). Sobra NULL so
--    se a caixa nao tinha sala ou se a sala foi apagada — e' o unico
--    descarte que o grafico da sala nao consegue contar.
SELECT count(*) AS descartados_sem_sala
  FROM public.documentos
 WHERE status = 'descartado' AND descarte_sala_id IS NULL;
-- g) o log do descarte (a localizacao de antes e' o historico)
-- SELECT criado_em, usuario_email, usuario_perfil,
--        dados_antes->>'status'    AS antes,
--        dados_antes->>'localizacao' AS estava_em,
--        dados_depois->>'caixa_id' AS caixa_depois,
--        dados_depois->>'descartado_em' AS descartado_em,
--        dados_depois->>'confirmacao' AS confirmacao
--   FROM public.auditoria
--  WHERE acao = 'DESCARTE'
--  ORDER BY criado_em DESC LIMIT 10;
-- ============================================================