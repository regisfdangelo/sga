-- ============================================================
-- SGA | Passo 3 de 3 - RPCs de gestao de usuarios
--   criar_usuario(email, nome, senha, perfil)
--   alterar_senha(id, senha)
--   excluir_usuario(id)
--
-- Todas sao SECURITY DEFINER e so respondem a administradores:
-- o papel 'arquivista' nao cadastra nem exclui usuario.
--
-- Onde executar: Supabase Dashboard > SQL Editor > New query > Run.
-- Pode ser executado mais de uma vez (idempotente).
-- Ordem: 01_perfis.sql -> 02_auditoria.sql -> 03_usuarios_rpc.sql
-- ============================================================

-- ------------------------------------------------------------
-- Hash de senha compativel com o Supabase Auth (bcrypt via pgcrypto)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sga_hash_senha(p_senha text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_hash text;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT extensions.crypt($1, extensions.gen_salt(''bf''))' INTO v_hash USING p_senha;
  ELSIF to_regprocedure('public.crypt(text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.crypt($1, public.gen_salt(''bf''))' INTO v_hash USING p_senha;
  ELSE
    RAISE EXCEPTION 'pgcrypto indisponivel. Ative a extensao pgcrypto no projeto.';
  END IF;
  RETURN v_hash;
END;
$$;

-- ------------------------------------------------------------
-- Cria usuario: conta em auth.users + linha em public.usuarios
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_usuario(
  p_email  text,
  p_nome   text,
  p_senha  text,
  p_perfil text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid;
  v_email  text := lower(trim(COALESCE(p_email, '')));
  v_nome   text := nullif(trim(COALESCE(p_nome, '')), '');
  v_perfil text := lower(trim(COALESCE(p_perfil, '')));
  v_hash   text;
BEGIN
  -- 1) Somente administrador
  IF COALESCE(public.sga_perfil(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem criar usuarios.';
  END IF;

  -- 2) Validacoes
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'E-mail invalido.';
  END IF;
  IF v_perfil NOT IN ('admin', 'arquivista') THEN
    RAISE EXCEPTION 'Perfil invalido. Use admin ou arquivista.';
  END IF;
  IF length(COALESCE(p_senha, '')) < 6 THEN
    RAISE EXCEPTION 'A senha precisa de pelo menos 6 caracteres.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'Ja existe um usuario com este e-mail.';
  END IF;

  v_hash := public.sga_hash_senha(p_senha);
  v_id   := gen_random_uuid();
  v_nome := COALESCE(v_nome, split_part(v_email, '@', 1));

  -- 3) Conta de autenticacao (e-mail ja confirmado: o admin criou)
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_sent_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_id, 'authenticated', 'authenticated', v_email, v_hash,
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nome', v_nome),
    now(), now()
  );

  -- 4) Identidade de login (exigida por algumas versoes do Auth)
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'identities'
         AND column_name = 'provider_id'
    ) THEN
      EXECUTE $q$
        INSERT INTO auth.identities
          (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        VALUES
          ($1, $1, $1::text,
           jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
           'email', now(), now(), now())
      $q$ USING v_id, v_email;
    ELSE
      EXECUTE $q$
        INSERT INTO auth.identities
          (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        VALUES
          (gen_random_uuid(), $1,
           jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true),
           'email', now(), now(), now())
      $q$ USING v_id, v_email;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Identidade de login nao criada (auth.identities): %', SQLERRM;
  END;

  -- 5) Perfil no SGA (dispara o trigger de auditoria)
  INSERT INTO public.usuarios (id, email, nome, perfil)
  VALUES (v_id, v_email, v_nome, v_perfil);

  RETURN jsonb_build_object(
    'id', v_id, 'email', v_email, 'nome', v_nome, 'perfil', v_perfil
  );

EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ja existe um usuario com este e-mail.';
END;
$$;

-- ------------------------------------------------------------
-- Redefine a senha de um usuario
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alterar_senha(p_id uuid, p_senha text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text;
BEGIN
  IF COALESCE(public.sga_perfil(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem redefinir senhas.';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Informe o usuario.';
  END IF;
  IF length(COALESCE(p_senha, '')) < 6 THEN
    RAISE EXCEPTION 'A senha precisa de pelo menos 6 caracteres.';
  END IF;

  v_hash := public.sga_hash_senha(p_senha);

  UPDATE auth.users
     SET encrypted_password  = v_hash,
         email_confirmed_at  = COALESCE(email_confirmed_at, now()),
         updated_at          = now()
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado no Supabase Auth.';
  END IF;

  -- Derruba sessoes antigas (refresh tokens)
  BEGIN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1' USING p_id;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Refresh tokens nao revogados: %', SQLERRM;
  END;
END;
$$;

-- ------------------------------------------------------------
-- Exclui usuario (login e perfil)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_usuario(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(public.sga_perfil(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir usuarios.';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Informe o usuario.';
  END IF;
  IF p_id = auth.uid() THEN
    RAISE EXCEPTION 'Nao e possivel excluir o proprio usuario.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_id AND perfil = 'admin')
     AND (SELECT count(*) FROM public.usuarios WHERE perfil = 'admin') <= 1 THEN
    RAISE EXCEPTION 'E necessario manter pelo menos um administrador no sistema.';
  END IF;

  DELETE FROM public.usuarios WHERE id = p_id;  -- registra na auditoria
  DELETE FROM auth.users WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'Conta de autenticacao nao encontrada para %.', p_id;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Permissoes de execucao: nada para anon, apenas authenticated
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.criar_usuario(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.alterar_senha(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.excluir_usuario(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sga_hash_senha(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.criar_usuario(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.alterar_senha(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_usuario(uuid) TO authenticated;
