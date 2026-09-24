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
  SUPABASE_URL: 'https://osqyqswxnistlqofdehj.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zcXlxc3d4bmlzdGxxb2ZkZWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDE0NTUsImV4cCI6MjEwNTgxNzQ1NX0.m1lXeLEw2qm-lwW7OZSBbrsb7ISoOREXlIAcejGrib4',

  // Chave usada no localStorage para guardar a sessão
  STORAGE_SESSION: 'sga_session',
  STORAGE_USER: 'sga_user',
  STORAGE_REMEMBER: 'sga_remember',

  // Tempo limite de inatividade (ms) - 2 horas
  SESSION_TIMEOUT: 2 * 60 * 60 * 1000,
};
