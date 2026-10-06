-- ============================================================
-- SGA | 21_limite_pastas_caixa.sql
-- Limite de pastas por caixa regrado NO BANCO.
--
-- PARA QUE SERVE
-- ------------------------------------------------------------
-- Cada caixa guarda no maximo `caixas.capacidade` pastas
-- (documentos), padrao 5. O front ja pula a caixa cheia quando
-- aloca sozinho a caixa no cadastro de documento, mas a
-- MOVIMENTACAO de pasta (modal "Editar documento" ->
-- Caixa / Localizacao Fisica) listava TODAS as caixas sem checar
-- ocupacao e nao revalidava no salvar: em teste deu para mover
-- uma pasta para uma caixa que ja estava 5/5 (ficou 6/5).
--
-- O QUE ESTE ARQUIVO FAZ
-- ------------------------------------------------------------
-- 1) Indice em documentos.caixa_id: o trigger conta as pastas
--    da caixa a cada INSERT/UPDATE; sem indice era seq scan.
-- 2) Funcao fn_limite_caixa() + trigger trg_limite_caixa
--    (BEFORE INSERT OR UPDATE em documentos): recusa a pasta
--    quando o destino ja esta no maximo.
--    * UPDATE so e cobrado quando muda caixa_id (editar nome,
--      status, descarte, etc. nao passa por aqui);
--    * a caixa e travada com FOR UPDATE, para duas movimentacoes
--      simultaneas para a mesma caixa passarem uma por vez
--      (sem dois "6o documento" ao mesmo tempo);
--    * a propria pasta nao conta: mover para a caixa em que ela
--      ja esta nunca e bloqueado;
--    * capacidade NULL/0 vale 5 (padrao do sistema).
--
-- REGRAS
-- ------------------------------------------------------------
-- - Idempotente: pode ser executado mais de uma vez.
-- - NAO altera dados ja gravados: uma caixa ja 6/5 continua 6/5
--   (o erro de teste continua visivel na arvore); ela apenas
--   deixa de aceitar pastas novas ate' uma delas ser movida
--   para fora.
-- - Conta TODOS os documentos da caixa, inclusive os com status
--   'descartado' - mesma contagem do restante do sistema
--   (RPC remover_caixa e arvore do Editar Arquivo).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Ordem: apos 19_descarte_documento.sql.
-- Depois de rodar: recarregue o navegador (Ctrl+F5).
-- ============================================================


-- ============================================================
-- 1) INDICE (o trigger consulta documentos.caixa_id sempre)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_documentos_caixa_id
  ON public.documentos (caixa_id);

COMMENT ON INDEX public.idx_documentos_caixa_id IS
  'Apoia o trigger trg_limite_caixa (contagem de pastas por caixa).';


-- ============================================================
-- 2) FUNCAO
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_limite_caixa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cod  text;
  v_cap  int;
  v_ocup bigint;
BEGIN
  -- UPDATE que nao mexe em caixa_id nao muda a ocupacao: nao cobra.
  IF TG_OP = 'UPDATE'
     AND NEW.caixa_id IS NOT DISTINCT FROM OLD.caixa_id THEN
    RETURN NEW;
  END IF;

  -- Documento sem caixa nao ocupa vaga.
  IF NEW.caixa_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- FOR UPDATE serializa movimentacoes concorrentes para a MESMA
  -- caixa: a segunda linha so segue depois que a primeira gravar.
  SELECT c.codigo, COALESCE(NULLIF(c.capacidade, 0), 5)
    INTO v_cod, v_cap
    FROM public.caixas c
   WHERE c.id = NEW.caixa_id
     FOR UPDATE;

  -- Caixa inexistente: deixa o FK (documentos.caixa_id) acusar.
  IF v_cod IS NULL THEN
    RETURN NEW;
  END IF;

  -- Conta as pastas JA guardadas, fora esta (NEW.id). Assim
  -- gravar/atualizar um documento NA caixa em que ele ja esta
  -- nunca e bloqueado.
  SELECT count(*) INTO v_ocup
    FROM public.documentos d
   WHERE d.caixa_id = NEW.caixa_id
     AND d.id IS DISTINCT FROM NEW.id;

  IF v_ocup >= v_cap THEN
    RAISE EXCEPTION
      'Limite de pastas atingido: a caixa % ja guarda % pasta(s) (maximo %). Mova uma pasta para outra caixa.',
      v_cod, v_ocup, v_cap;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_limite_caixa() IS
  'BEFORE INSERT/UPDATE em documentos: bloqueia pasta nova em caixa ja no maximo de capacidade.';


-- ============================================================
-- 3) TRIGGER
-- ============================================================
DROP TRIGGER IF EXISTS trg_limite_caixa ON public.documentos;
CREATE TRIGGER trg_limite_caixa
  BEFORE INSERT OR UPDATE ON public.documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_limite_caixa();


-- ============================================================
-- 4) VERIFICACAO
-- ============================================================

-- a) trigger instalado (esperado: trg_limite_caixa em documentos)
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definicao
  FROM pg_trigger t
  JOIN pg_class c      ON c.oid = t.tgrelid
  JOIN pg_namespace n  ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname = 'documentos'
   AND NOT t.tgisinternal
 ORDER BY t.tgname;

-- b) caixas acima do limite, se ainda houver (corrija movendo as
--    pastas excedentes para fora: a 6a pasta de uma caixa 5/5)
SELECT c.codigo,
       count(d.id)                      AS pastas,
       COALESCE(NULLIF(c.capacidade, 0), 5) AS capacidade
  FROM public.caixas c
  LEFT JOIN public.documentos d ON d.caixa_id = c.id
 GROUP BY c.id
HAVING count(d.id) > COALESCE(NULLIF(c.capacidade, 0), 5)
 ORDER BY pastas DESC;

-- c) teste do trigger (transacao revertida - nao deixa rastro):
--    troque o protocolo por um documento de teste e o id por uma
--    caixa que ja esteja CHEIA. Esperado:
--    ERROR: Limite de pastas atingido: a caixa CX-000001 ja
--    guarda 5 pasta(s) (maximo 5). ...
--
-- BEGIN;
--   UPDATE public.documentos
--      SET caixa_id = (SELECT id FROM public.caixas
--                       WHERE codigo = 'CX-000001' LIMIT 1)
--    WHERE protocolo = '2026-000001';
-- ROLLBACK;
--
-- Depois do ROLLBACK, confira que nada mudou:
-- SELECT protocolo, caixa_id FROM public.documentos
--  WHERE protocolo = '2026-000001';
