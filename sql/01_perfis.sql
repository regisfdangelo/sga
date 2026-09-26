-- ============================================================
-- SGA | Passo 1 de 3 - PERFIS
-- Remove o perfil "solicitante": restam apenas 'admin' e 'arquivista'.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Pode ser executado mais de uma vez (idempotente).
-- Ordem: 01_perfis.sql -> 02_auditoria.sql -> 03_usuarios_rpc.sql
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 1.1 - Diagnostico: quem ainda esta fora de admin/arquivista
-- ------------------------------------------------------------
SELECT id, email, nome, perfil
FROM public.usuarios
WHERE COALESCE(perfil, '') NOT IN ('admin', 'arquivista')
ORDER BY email;

-- ------------------------------------------------------------
-- PASSO 1.2 - RESOLVA AQUI (descomente UMA opcao e execute)
-- Enquanto restar perfil diferente de admin/arquivista, o CHECK
-- do PASSO 1.6 nao sera criado (aviso no final da execucao).
--
-- (a) Reatribuir todos como arquivista:
--
-- UPDATE public.usuarios
--    SET perfil = 'arquivista'
--  WHERE COALESCE(perfil, '') NOT IN ('admin', 'arquivista');
--
-- (b) Remover do SGA (apaga a linha e o login em auth.users):
--
-- WITH removidos AS (
--   DELETE FROM public.usuarios
--    WHERE COALESCE(perfil, '') NOT IN ('admin', 'arquivista')
--   RETURNING email
-- )
-- DELETE FROM auth.users u
--  USING removidos r
--  WHERE lower(u.email) = lower(r.email);
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- PASSO 1.3 - Descarta qualquer constraint que ainda aceite 'solicitante'
-- ------------------------------------------------------------
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.usuarios'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%solicitante%'
  LOOP
    EXECUTE format('ALTER TABLE public.usuarios DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Constraint removida: %', c.conname;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- PASSO 1.4 - Funcoes de perfil
--   sga_perfil(): SECURITY DEFINER - usada pelas NOVAS policies
--     deste arquivo. Como le public.usuarios com os privilegios do
--     dono, evita a recursao infinita de RLS dentro de policy.
--   meu_perfil(): so cria se nao existir (ja e usada pelas
--     policies antigas de INSERT/UPDATE).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sga_perfil() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT perfil FROM public.usuarios WHERE id = auth.uid()
$$;

-- EXECUTE continua PUBLIC (padrao): as policies rodam com os
-- privilegios do usuario que consulta, e a funcao apenas devolve
-- o proprio perfil de quem chamou.
GRANT EXECUTE ON FUNCTION public.sga_perfil() TO authenticated, anon;

DO $$
BEGIN
  IF to_regprocedure('public.meu_perfil()') IS NULL THEN
    EXECUTE 'CREATE FUNCTION public.meu_perfil() RETURNS text'
         || ' LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public'
         || ' AS ''SELECT perfil FROM public.usuarios WHERE id = auth.uid()''';
    RAISE NOTICE 'Funcao public.meu_perfil() criada.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- PASSO 1.5 - RLS de public.usuarios
--   SELECT: cada um le a propria linha; admin le todas
--   INSERT/UPDATE/DELETE: somente admin
--   (o INSERT do proprio usuario nao existe mais: o cadastro
--    passa a ser feito exclusivamente pela RPC criar_usuario)
-- ------------------------------------------------------------
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'usuarios'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.usuarios', p.policyname);
    RAISE NOTICE 'Politica removida: %', p.policyname;
  END LOOP;
END $$;

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY usuarios_select ON public.usuarios
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.sga_perfil() = 'admin');

CREATE POLICY usuarios_insert ON public.usuarios
  FOR INSERT TO authenticated
  WITH CHECK (public.sga_perfil() = 'admin');

CREATE POLICY usuarios_update ON public.usuarios
  FOR UPDATE TO authenticated
  USING (public.sga_perfil() = 'admin')
  WITH CHECK (public.sga_perfil() = 'admin');

CREATE POLICY usuarios_delete ON public.usuarios
  FOR DELETE TO authenticated
  USING (public.sga_perfil() = 'admin');

-- O papel anonim nao precisa tocar em usuarios (a anon key e publica)
REVOKE ALL ON public.usuarios FROM anon;

-- ------------------------------------------------------------
-- PASSO 1.6 - CHECK do perfil (criado so se nao restar ninguem fora)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.usuarios
     WHERE COALESCE(perfil, '') NOT IN ('admin', 'arquivista')
  ) THEN
    RAISE NOTICE 'ATENCAO: ainda existem perfis fora de admin/arquivista; o CHECK usuarios_perfil_valido NAO foi criado. Execute o PASSO 1.2 e rode este arquivo novamente.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.usuarios'::regclass
       AND conname = 'usuarios_perfil_valido'
  ) THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_perfil_valido CHECK (perfil IN ('admin', 'arquivista'));
    RAISE NOTICE 'Constraint usuarios_perfil_valido criada.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- PASSO 1.7 - Verificacao final
-- ------------------------------------------------------------
-- Politicas que ainda mencionem 'solicitante' (esperado: zero linhas)
SELECT schemaname, tablename, policyname, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (qual ILIKE '%solicitante%' OR with_check ILIKE '%solicitante%');

-- Logins em auth.users sem linha correspondente em public.usuarios
SELECT u.id, u.email
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.usuarios x WHERE x.id = u.id);
