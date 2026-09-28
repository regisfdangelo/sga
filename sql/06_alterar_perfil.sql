-- ============================================================
-- SGA | 06_alterar_perfil.sql
-- P3 do relatorio de seguranca: EVITA LOCKOUT DO ULTIMO ADMIN.
--
-- Problema (item 6 / P3): a RPC excluir_usuario() protege o ultimo
-- administrador, mas alterarPerfil() era um UPDATE direto via RLS
-- admin - um administrador podia rebaixar o ultimo admin (ou
-- exclui-lo por DELETE direto) e deixar o sistema sem administrador.
--
-- Correcao:
--   1. RPC alterar_perfil(p_id, p_perfil): exige admin, valida o
--      perfil, impede alterar o proprio perfil e mantem sempre
--      >= 1 administrador no sistema.
--   2. UPDATE/DELETE diretos em public.usuarios revogados para
--      authenticated - senao a guarda da RPC (e a de
--      excluir_usuario) seria contornavel por um PATCH/DELETE
--      direto na API. Trigger e RPCs continuam funcionando porque
--      rodam como dono da tabela (SECURITY DEFINER).
--   3. Front (assets/js/api.js -> alterarPerfil) troca
--      update('usuarios', ...) pela chamada a RPC.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: 01_perfis.sql -> 02_auditoria.sql -> 03_usuarios_rpc.sql
--        -> 04_rls_negocio.sql -> 05_auditoria_auth.sql
--        -> 06_alterar_perfil.sql
--
-- ⚠️ ORDEM DE IMPLANTACAO: execute ESTE arquivo ANTES de publicar a
--    alteracao do front-end. Entre o SQL e o push, o botao "Perfil"
--    da tela de Usuarios falha com "permission denied" (visivel,
--    sem perda de dados) e volta a funcionar apos a publicacao.
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 1 - RPC com a guarda do ultimo administrador
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alterar_perfil(p_id uuid, p_perfil text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_perfil text := lower(trim(COALESCE(p_perfil, '')));
BEGIN
  -- 1) Somente administrador
  IF COALESCE(public.sga_perfil(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar perfis.';
  END IF;

  -- 2) Validacoes
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Informe o usuario.';
  END IF;
  IF v_perfil NOT IN ('admin', 'arquivista') THEN
    RAISE EXCEPTION 'Perfil invalido. Use admin ou arquivista.';
  END IF;
  IF p_id = auth.uid() THEN
    RAISE EXCEPTION 'Nao e possivel alterar o proprio perfil.';
  END IF;

  -- 3) Precisa manter pelo menos um administrador no sistema
  IF v_perfil <> 'admin'
     AND EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = p_id AND u.perfil = 'admin')
     AND (SELECT count(*) FROM public.usuarios WHERE perfil = 'admin') <= 1 THEN
    RAISE EXCEPTION 'E necessario manter pelo menos um administrador no sistema.';
  END IF;

  -- 4) Alteracao (dispara o trigger de auditoria na tabela usuarios)
  UPDATE public.usuarios SET perfil = v_perfil WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.alterar_perfil(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alterar_perfil(uuid, text) TO authenticated;

-- ------------------------------------------------------------
-- PASSO 2 - Bloqueia o caminho direto que contornava a guarda
-- A policy usuarios_update/usuarios_delete continua valendo (RLS),
-- mas sem grant nao ha INSERT/UPDATE/DELETE via PostgREST para
-- authenticated. INSERT nao e revogado aqui: nao tem relacao com o
-- lockout e o cadastro legitimo e feito pela RPC criar_usuario.
-- ------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.usuarios FROM authenticated;
REVOKE UPDATE, DELETE ON public.usuarios FROM anon;

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
   AND p.proname = 'alterar_perfil';

-- b) UPDATE/DELETE indisponiveis para os papels ALCANCIVEIS PELO
--    CLIENTE (esperado: ZERO linhas). postgres/service_role sao
--    papels de servidor e continuam com acesso.
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name = 'usuarios'
   AND privilege_type IN ('UPDATE', 'DELETE')
   AND grantee IN ('anon', 'authenticated')
 ORDER BY table_name, privilege_type;

-- c) Teste da permissao: no SQL Editor nao ha JWT (auth.uid() nulo),
--    entao a RPC DEVE falhar com a mensagem de permissao:
--    "Apenas administradores podem alterar perfis."
-- SELECT public.alterar_perfil('<qualquer uuid>'::uuid, 'arquivista');

-- d) Teste pratico (com token de admin, via API):
-- curl -X POST "https://osqyqswxnistlqofdehj.supabase.co/rest/v1/rpc/alterar_perfil" \
--   -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <TOKEN_ADMIN>" \
--   -H "Content-Type: application/json" \
--   -d '{"p_id":"<ULTIMO_ADMIN_UUID>","p_perfil":"arquivista"}'
-- Resposta esperada: erro "E necessario manter pelo menos um administrador..."
--
-- E o PATCH direto (caminho antigo) deve falhar com 403:
-- curl -X PATCH "https://osqyqswxnistlqofdehj.supabase.co/rest/v1/usuarios?id=eq.<UUID>" \
--   -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <TOKEN_ADMIN>" \
--   -H "Content-Type: application/json" -H "Prefer: return=representation" \
--   -d '{"perfil":"arquivista"}'
-- Resposta esperada: 403 (permission denied)
