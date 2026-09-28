-- ============================================================
-- SGA | 05_auditoria_auth.sql
-- P2 do relatorio de seguranca: AUDITORIA SEM CAMPOS FORJAVEIS.
--
-- Problema (item 5 / P2): a policy auditoria_insert_eventos so
-- exigia usuario_id = auth.uid(); usuario_email e usuario_perfil
-- eram enviados pelo CLIENTE - um usuario autenticado podia gravar
-- um evento LOGIN com e-mail/perfil falsos na trilha de auditoria.
--
-- Correcao:
--   1. RPC registrar_evento_auth(p_acao) preenche usuario_id,
--      usuario_email e usuario_perfil NO SERVIDOR (auth.uid() +
--      public.usuarios). O cliente envia apenas a acao.
--   2. INSERT direto em public.auditoria deixa de existir para
--      authenticated/anon: so a RPC e os triggers (SECURITY
--      DEFINER, executam com privilegios do dono da tabela)
--      gravam eventos.
--   3. A policy e reforcada (defesa em profundidade) para o caso de
--      o grant de INSERT ser reaberto acidentalmente no futuro.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: 01_perfis.sql -> 02_auditoria.sql -> 03_usuarios_rpc.sql
--        -> 04_rls_negocio.sql -> 05_auditoria_auth.sql
--
-- ⚠️ ORDEM DE IMPLANTACAO:
--    1) Execute ESTE arquivo no SQL Editor;
--    2) Depois publique a alteracao do front-end
--       (assets/js/api.js -> registrarEvento passa a chamar a RPC).
--    Se publicar o front antes, os eventos LOGIN/LOGOUT nao sao
--    gravados ate o SQL rodar.
--
-- ⚠️ ATENCAO: reexecutar 02_auditoria.sql DEPOIS deste arquivo
--    volta a conceder o INSERT direto e recria a policy antiga.
--    Se isso acontecer, execute este 05 novamente.
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 1 - RPC que preenche e-mail/perfil NO SERVIDOR
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_evento_auth(p_acao text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Somente os eventos de autenticacao
  IF p_acao IS NULL OR upper(p_acao) NOT IN ('LOGIN', 'LOGOUT') THEN
    RAISE EXCEPTION 'Acao invalida.';
  END IF;

  -- Identidade lida do banco (auth.uid() + public.usuarios),
  -- NUNCA vinda do cliente. Sem linha em usuarios, nada e gravado.
  INSERT INTO public.auditoria
    (usuario_id, usuario_email, usuario_perfil, tabela, acao, registro_id)
  SELECT id, email, perfil, 'auth', upper(p_acao), id::text
    FROM public.usuarios
   WHERE id = auth.uid();
END;
$$;

-- A anon key e publica: anon e PUBLIC nao podem executar
REVOKE ALL ON FUNCTION public.registrar_evento_auth(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_evento_auth(text) TO authenticated;

-- ------------------------------------------------------------
-- PASSO 2 - Proibe o INSERT direto (mantem so a RPC)
-- Os triggers de fn_auditoria() continuam gravando normalmente:
-- a funcao e SECURITY DEFINER (roda com os privilegios do dono).
-- ------------------------------------------------------------
REVOKE ALL ON public.auditoria FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.auditoria FROM authenticated;
GRANT SELECT ON public.auditoria TO authenticated;
-- (o SELECT admin e o TRUNCATE/UPDATE/DELETE revogados ja estao em 02_auditoria.sql)

-- ------------------------------------------------------------
-- PASSO 3 - Policy reforçada (defesa em profundidade)
-- O INSERT ja esta bloqueado no nivel de grant (PASSO 2); esta
-- policy garante que, mesmo que o grant volte por engano, o evento
-- so seja aceito com os valores REAIS do banco.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS auditoria_insert_eventos ON public.auditoria;

CREATE POLICY auditoria_insert_eventos ON public.auditoria
  FOR INSERT TO authenticated
  WITH CHECK (
    tabela = 'auth'
    AND acao IN ('LOGIN', 'LOGOUT')
    AND usuario_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid())
    AND usuario_email IS NOT DISTINCT FROM
        (SELECT email FROM public.usuarios WHERE id = auth.uid())
    AND usuario_perfil IS NOT DISTINCT FROM public.sga_perfil()
  );

-- ------------------------------------------------------------
-- VERIFICACAO FINAL
-- ------------------------------------------------------------
-- a) RPC existe, e SECURITY DEFINER e so authenticated executa
--    (esperado: auth_exec = true, anon_exec = false)
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef                              AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'registrar_evento_auth';

-- b) INSERT nao disponivel para os papels ALCANCIVEIS PELO CLIENTE
--    (anon e authenticated). Esperado: ZERO linhas.
--    Linhas para postgres e/ou service_role sao ESPERADAS e nao sao
--    risco: postgres e o dono da tabela (triggers e RPC rodam como
--    ele, SECURITY DEFINER); service_role so e usado com a
--    SERVICE_ROLE KEY (secreta, nunca presente no navegador).
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name = 'auditoria'
   AND privilege_type = 'INSERT'
   AND grantee IN ('anon', 'authenticated');

-- c) Politicas da auditoria (esperado: auditoria_select admin +
--    auditoria_insert_eventos com a checagem de e-mail/perfil)
SELECT tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'auditoria'
 ORDER BY policyname;

-- d) Teste pratico: com a sessao de um usuario qualquer (e token
--    valido), o INSERT direto deve falhar com 403 permission denied
--    e a RPC deve gravar o evento com o e-mail REAL do banco:
--
-- curl -X POST "https://osqyqswxnistlqofdehj.supabase.co/rest/v1/auditoria" \
--   -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ACCESS_TOKEN>" \
--   -H "Content-Type: application/json" -H "Prefer: return=representation" \
--   -d '{"usuario_id":"<SEU_UID>","usuario_email":"forjado@x.com","usuario_perfil":"admin","tabela":"auth","acao":"LOGIN"}'
-- Resposta esperada: 403 (permission denied)
--
-- curl -X POST "https://osqyqswxnistlqofdehj.supabase.co/rest/v1/rpc/registrar_evento_auth" \
--   -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ACCESS_TOKEN>" \
--   -H "Content-Type: application/json" \
--   -d '{"p_acao":"LOGIN"}'
-- Resposta esperada: 204 e linha nova em auditoria com o e-mail do
-- proprio usuario (nao o digitado).
