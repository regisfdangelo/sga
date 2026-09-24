/**
 * SGA - Configuração
 * Preencha com os dados do seu projeto Supabase (Settings > API).
 *
 * SEGURANÇA:
 * - A ANON KEY é pública por design no Supabase.
 * - A proteção real vem das Políticas de RLS (Row Level Security),
 *   configuradas no banco. O IMPLANTACAO.md traz o passo a passo.
 * - NUNCA exponha a SERVICE_ROLE KEY no navegador.
 */
const SGA_CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'SUA_ANON_KEY_AQUI',

  // Chave usada no localStorage para guardar a sessão
  STORAGE_SESSION: 'sga_session',
  STORAGE_USER: 'sga_user',
  STORAGE_REMEMBER: 'sga_remember',

  // Tempo limite de inatividade (ms) - 2 horas
  SESSION_TIMEOUT: 2 * 60 * 60 * 1000,
};
