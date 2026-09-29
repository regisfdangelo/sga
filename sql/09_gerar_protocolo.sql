-- ============================================================
-- SGA | Passo 9 - Protocolo atomico (AAAA-NNNNNN)
--   protocolo_sequencia(ano, ultimo)
--   gerar_protocolo()      -> RESERVA o proximo numero (incrementa)
--   proximo_protocolo()    -> apenas MOSTRA o proximo (nao consome)
--   indice UNIQUE em documentos(protocolo)
--
-- Motivo: a geracao era feita no navegador (le MAX + 1), sem transacao
-- e sem trava. Dois usuarios liam o mesmo MAX -> numero duplicado /
-- sequencia fora de ordem. A funcao gerar_protocolo() referenciada em
-- assets/js/api.js nunca existiu no banco; este script a cria.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Pode ser executado mais de uma vez (idempotente).
-- Ordem: 01..08 -> 09_gerar_protocolo.sql
--
-- ANTES DE RODAR, verifique se ha protocolos duplicados:
--   SELECT protocolo, count(*) FROM public.documentos
--    WHERE protocolo IS NOT NULL GROUP BY protocolo HAVING count(*) > 1;
-- Se houver, corrija (mantenha o mais antigo) e rode o script de novo.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tabela de sequencia: um contador por ano
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protocolo_sequencia (
  ano    integer PRIMARY KEY,
  ultimo bigint  NOT NULL DEFAULT 0
);

-- Ninguem escreve/le a tabela direto; so as funcoes abaixo (SECURITY DEFINER)
REVOKE ALL ON public.protocolo_sequencia FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) gerar_protocolo(): proximo numero do ano corrente.
--    Trava por ano (advisory lock transacional) -> sem corrida:
--    duas chamadas simultaneas retornam numeros diferentes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_protocolo()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ano  int    := to_char(now(), 'YYYY')::int;
  v_seq  bigint;
BEGIN
  -- trava de aplicacao (liberada no commit/rollback), uma por ano
  PERFORM pg_advisory_xact_lock(870109, v_ano);

  -- primeira execucao do ano: parte do maior protocolo ja existente
  INSERT INTO public.protocolo_sequencia (ano, ultimo)
  SELECT v_ano, COALESCE(
    max(NULLIF(regexp_replace(split_part(protocolo, '-', 2), '\D', '', 'g'), '')::bigint),
    0)
    FROM public.documentos
   WHERE left(protocolo, 5) = v_ano::text || '-'
  ON CONFLICT (ano) DO NOTHING;

  UPDATE public.protocolo_sequencia
     SET ultimo = ultimo + 1
   WHERE ano = v_ano
  RETURNING ultimo INTO v_seq;

  RETURN format('%s-%s', v_ano, lpad(v_seq::text, 6, '0'));
END;
$$;

-- ------------------------------------------------------------
-- 3) proximo_protocolo(): MESMO valor, porem sem incrementar.
--    Usado só para o preview da tela de cadastro; nao consome
--    numero (por isso nao ha "buraco" na sequencia).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proximo_protocolo()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ano  int;
  v_seq  bigint;
BEGIN
  v_ano := to_char(now(), 'YYYY')::int;

  SELECT GREATEST(
           COALESCE((SELECT ultimo FROM public.protocolo_sequencia WHERE ano = v_ano), 0),
           COALESCE((
             SELECT max(NULLIF(regexp_replace(split_part(protocolo, '-', 2), '\D', '', 'g'), '')::bigint)
               FROM public.documentos
              WHERE left(protocolo, 5) = v_ano::text || '-'
           ), 0)
         ) + 1
    INTO v_seq;

  RETURN format('%s-%s', v_ano, lpad(v_seq::text, 6, '0'));
END;
$$;

-- ------------------------------------------------------------
-- 4) Unicidade: o banco passa a barrar protocolo repetido
--    (CREATE UNIQUE INDEX IF NOT EXISTS = idempotente)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS documentos_protocolo_unico
  ON public.documentos (protocolo);

-- ------------------------------------------------------------
-- 5) Permissoes: apenas usuarios autenticados (nao anon)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.gerar_protocolo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proximo_protocolo() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.gerar_protocolo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.proximo_protocolo() TO authenticated;

-- VERIFICACOES
-- SELECT public.proximo_protocolo();   -- mostra sem consumir
-- SELECT public.gerar_protocolo();     -- consome 1 numero
-- SELECT * FROM public.protocolo_sequencia ORDER BY ano;
