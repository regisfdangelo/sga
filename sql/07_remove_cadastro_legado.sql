-- ============================================================
-- SGA | 07_remove_cadastro_legado.sql
-- Correcao dos problemas de criacao e LOGIN de usuario:
--   1) "new row for relation 'usuarios' violates check constraint
--       'usuarios_perfil_valido'" (ao criar);
--   2) HTTP 500 "Database error querying schema" (ao logar).
--
-- Causa 1 (diagnosticada em 28/09/2026 via pg_trigger/pg_proc):
--   Trigger legado on_auth_user_created (AFTER INSERT ON
--   auth.users) aciona public.handle_new_user(), que insere em
--   public.usuarios SEM perfil explicito - a coluna tem DEFAULT
--   'solicitante' (antigo cadastro publico), que viola o CHECK
--   usuarios_perfil_valido e aborta a RPC criar_usuario.
--
-- Causa 2 (docs oficiais Supabase - "Auth error 500"):
--   a RPC criar_usuario insere em auth.users via SQL direto e
--   deixa colunas de token (confirmation_token, recovery_token,
--   email_change, ...) como NULL; o GoTrue escaneia essas colunas
--   como STRING no login e aborta com 500. O GoTrue proprio grava
--   ''. Usuario criado pelo Dashboard/API nunca tem esse problema.
--
-- Correcao:
--   - PASSO 1: DROP do DEFAULT 'solicitante' (valor sempre
--     explicito em public.usuarios.perfil);
--   - PASSO 2/3: DROP do trigger e da funcao legados: o cadastro
--     legitimo acontece pela RPC criar_usuario (auditada, valida
--     perfil, cria auth.users + public.usuarios);
--   - PASSO 4: normaliza tokens NULL -> '' nos usuarios JA
--     criados (a correcao FUTURA esta na propria rpc, sql/03);
--   - Usuario criado direto no Dashboard (Auth > Users) NAO tera
--     linha em public.usuarios e nao entra no SGA - comportamento
--     desejado: sem linha em usuarios, sem acesso.
--
-- ⚠️ APOS rodar este arquivo, reexecute tambem sql/03_usuarios_rpc.sql
--    (a RPC ganhou o passo que evita tokens NULL nas próximas criacoes).
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Idempotente: pode ser executado mais de uma vez.
-- Ordem: 01 -> 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> (reexecute 03)
--
-- ⚠️ O SQL Editor para no PRIMEIRO erro e mantem o que ja executou
-- (execucao sem transacao). Por isso a ordem abaixo coloca o
-- comando garantisimo (DROP DEFAULT) PRIMEIRO e isola a remocao da
-- funcao num bloco que NAO aborta o restante do script.
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 1 - Remove o DEFAULT 'solicitante' da coluna perfil
-- (primeiro: e o comando mais critico e nao pode ser perdido por
--  um erro de dependencia em qualquer outro passo)
-- ------------------------------------------------------------
ALTER TABLE public.usuarios ALTER COLUMN perfil DROP DEFAULT;

-- ------------------------------------------------------------
-- PASSO 2 - Remove o trigger legado em auth.users
-- (precisa ser removido ANTES da funcao, senao ha dependencia)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ------------------------------------------------------------
-- PASSO 3 - Remove a funcao legada (qualquer assinatura)
-- Nao aborta o script: erro de dependencia vira NOTICE e a
-- VERIFICACAO (b) abaixo acusa se a funcao sobrou.
-- ------------------------------------------------------------
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  LOOP
    BEGIN
      EXECUTE format('DROP FUNCTION public.handle_new_user(%s)', f.args);
      RAISE NOTICE 'Funcao legada removida: public.handle_new_user(%)', f.args;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'AVISO: nao foi possivel remover public.handle_new_user(%): %',
                   f.args, SQLERRM;
    END;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- PASSO 4 - Conserta o LOGIN dos usuarios ja criados
-- Colunas de token do auth.users com NULL quebram o login com
-- 500 "Database error querying schema" (o GoTrue espera '').
-- So colunas existentes no schema e so NULL -> ''; valores reais
-- nunca sao tocados. (Futuras criacoes sao cobertas pela rpc 03.)
-- ------------------------------------------------------------
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'auth'
       AND table_name = 'users'
       AND (column_name LIKE '%\_token%'
            OR column_name IN ('email_change', 'phone_change'))
  LOOP
    EXECUTE format('UPDATE auth.users SET %I = %L WHERE %I IS NULL',
                   c.column_name, '', c.column_name);
    RAISE NOTICE 'Tokens normalizados: auth.users.%', c.column_name;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- VERIFICACAO FINAL (esperados: 0 linhas / NULL / false)
-- ------------------------------------------------------------
-- a) nenhum trigger sobrando em auth.users (alem dos internos)
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definicao
  FROM pg_trigger t
 WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal;

-- b) funcao legada inexiste (esperado: ZERO linhas)
SELECT n.nspname, p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname = 'handle_new_user';

-- c) coluna perfil sem DEFAULT (esperado: column_default NULL)
SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'usuarios'
   AND column_name = 'perfil';

-- d) CHECK continua protegendo (esperado: apenas admin/arquivista)
SELECT conname, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint
 WHERE conrelid = 'public.usuarios'::regclass AND contype = 'c';

-- e) NENHUM token NULL em auth.users (esperado: ZERO linhas).
--    Se alguma coluna nao existir no seu schema, pule esta query.
SELECT email, confirmation_token, recovery_token,
       email_change, email_change_token_new
  FROM auth.users
 WHERE confirmation_token IS NULL
    OR recovery_token IS NULL
    OR email_change IS NULL
    OR email_change_token_new IS NULL;

-- ------------------------------------------------------------
-- TESTE (somente pela interface - a RPC exige JWT de admin)
-- 1) Painel > Usuarios > Novo usuario > preencher > Criar usuario
--    Esperado: toast "Usuario <e-mail> criado!" e linha na tabela.
--    (No SQL Editor a chamada falharia com "Apenas administradores
--     podem criar usuarios", pois nao ha auth.uid().)
-- 2) Fazer login com o usuario recem-criado
--    Esperado: entra no painel; NADA de 500
--    "Database error querying schema".
--    Se ainda falhar: Dashboard > Logs > Auth (ver o error_id) e
--    Dashboard > Database > Logs > Postgres (erro real).
-- ------------------------------------------------------------
