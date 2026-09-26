/**
 * SGA - Camada de API (Supabase REST + Auth)
 * Comunicação via fetch() puro, sem dependências externas.
 *
 * Fluxo de autenticação:
 *  1. login()  -> POST /auth/v1/token?grant_type=password
 *  2. Sessão armazenada no localStorage com expiração
 *  3. Requests autenticados enviam Authorization: Bearer <access_token>
 */
const SGA_API = (() => {
  const BASE = () => SGA_CONFIG.SUPABASE_URL.replace(/\/$/, '');
  const ANON = () => SGA_CONFIG.SUPABASE_ANON_KEY;

  /* ----------------------------------------------------------
     Helpers internos
     ---------------------------------------------------------- */

  /** Lê a sessão salva e valida expiração. */
  function getSession() {
    try {
      const raw = localStorage.getItem(SGA_CONFIG.STORAGE_SESSION);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.access_token) return null;
      if (session.expires_at && Date.now() >= session.expires_at) {
        clearSession();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    // Supabase retorna expires_at em SEGUNDOS (Unix timestamp, ~1.7e9).
    // Date.now() usa MILISSEGUNDOS (~1.7e12).
    // Regra: se valor < 1e12, é segundos → multiplica por 1000.
    //        se valor >= 1e12, já é milissegundos → usa direto.
    let expiresAt;
    if (session.expires_at) {
      const raw = Number(session.expires_at);
      expiresAt = raw < 1e12 ? raw * 1000 : raw;
    } else {
      expiresAt = Date.now() + (session.expires_in || 3600) * 1000;
    }
    const toStore = { ...session, expires_at: expiresAt };
    localStorage.setItem(SGA_CONFIG.STORAGE_SESSION, JSON.stringify(toStore));
    return toStore;
  }

  function clearSession() {
    localStorage.removeItem(SGA_CONFIG.STORAGE_SESSION);
    localStorage.removeItem(SGA_CONFIG.STORAGE_USER);
    if (!localStorage.getItem(SGA_CONFIG.STORAGE_REMEMBER)) {
      // mantém preferência "lembrar-me" se marcada
    }
  }

  /** Requisição genérica autenticada. */
  async function request(method, path, body, options = {}) {
    const session = getSession();
    const url = `${BASE()}${path}`;

    const headers = {
      apikey: ANON(),
      'Content-Type': 'application/json',
      ...options.headers,
    };
    if (session && session.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const err = await res.json();
        detail = err.message || err.error_description || err.error || '';
      } catch { /* corpo não-JSON */ }

      // Sessão expirada / inválida
      if (res.status === 401) {
        clearSession();
        if (!options.silent401) {
          window.location.href = 'index.html';
        }
      }
      throw new Error(detail || `Erro ${res.status}: ${res.statusText}`);
    }

    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /* ----------------------------------------------------------
     Autenticação
     ---------------------------------------------------------- */

  async function login(email, password) {
    const res = await fetch(`${BASE()}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: ANON(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      let msg = 'Falha na autenticação.';
      try {
        const err = await res.json();
        msg = err.error_description || err.msg || err.message || msg;
      } catch { /* ignore */ }
      // Mensagens amigáveis em português
      if (/invalid login credentials/i.test(msg)) {
        msg = 'E-mail ou senha incorretos.';
      } else if (/email not confirmed/i.test(msg)) {
        msg = 'E-mail ainda não confirmado. Verifique sua caixa de entrada.';
      }
      throw new Error(msg);
    }

    const session = saveSession(await res.json());

    // Perfil obrigatório: sem linha em public.usuarios não há acesso.
    const profile = await getUsuario(session.user);
    if (!profile || !PERFIS.includes(profile.perfil)) {
      clearSession();
      throw new Error('Usuário sem perfil ativo no SGA. Procure o administrador para liberação.');
    }
    localStorage.setItem(SGA_CONFIG.STORAGE_USER, JSON.stringify(profile));

    return { session, profile };
  }

  async function logout() {
    const session = getSession();
    if (session) {
      try {
        await fetch(`${BASE()}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            apikey: ANON(),
            Authorization: `Bearer ${session.access_token}`,
          },
        });
      } catch { /* segue o fluxo mesmo com erro */ }
    }
    clearSession();
    localStorage.removeItem(SGA_CONFIG.STORAGE_USER);
    localStorage.removeItem(SGA_CONFIG.STORAGE_REMEMBER);
  }

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(SGA_CONFIG.STORAGE_USER) || 'null');
    } catch {
      return null;
    }
  }

  /**
   * Perfis válidos do SGA. O cadastro público de perfil (solicitante)
   * foi removido: quem não tem linha em public.usuarios não entra.
   * SEGURANCA: o perfil NUNCA vem do cliente nem de user_metadata.
   */
  const PERFIS = ['admin', 'arquivista'];

  /** Lê o perfil do usuário em public.usuarios. Sem auto-criação. */
  async function getUsuario(authUser) {
    if (!authUser || !authUser.id) return null;
    try {
      // silent401: não redireciona nem limpa sessão se falhar
      const rows = await request('GET', `/rest/v1/usuarios?id=eq.${authUser.id}&select=*`, undefined, { silent401: true });
      if (rows && rows.length) return rows[0];
    } catch { /* tabela pode não existir ainda */ }
    return null;
  }

  /* ----------------------------------------------------------
     CRUD genérico
     ---------------------------------------------------------- */

  const list = (table, query = '') => request('GET', `/rest/v1/${table}?select=*${query}`);
  const insert = (table, data) =>
    request('POST', `/rest/v1/${table}`, data, { headers: { Prefer: 'return=representation' } });
  const update = (table, id, data) =>
    request('PATCH', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, data, {
      headers: { Prefer: 'return=representation' },
    });
  const remove = (table, id) =>
    request('DELETE', `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`);

  /* ----------------------------------------------------------
     Protocolo: 2026-000001 (ano + sequência de 6 dígitos)
     Tenta a função RPC primeiro; senão calcula no cliente.
     ---------------------------------------------------------- */
  async function gerarProtocolo() {
    // 1) Função SQL (ideal - atômica no banco)
    try {
      const r = await request('POST', '/rest/v1/rpc/gerar_protocolo', {});
      if (r && /^\d{4}-\d{6}$/.test(String(r))) return r;
    } catch { /* função ainda não criada - fallback abaixo */ }

    // 2) Fallback: lê o maior protocolo do ano corrente e incrementa
    const ano = new Date().getFullYear();
    try {
      const rows = await request(
        'GET',
        `/rest/v1/documentos?protocolo=like.${ano}-*&select=protocolo&order=protocolo.desc&limit=1`
      );
      let seq = 1;
      if (rows && rows.length) {
        const partes = String(rows[0].protocolo).split('-');
        seq = (parseInt(partes[1], 10) || 0) + 1;
      }
      return `${ano}-${String(seq).padStart(6, '0')}`;
    } catch {
      // Sem acesso ainda - devolve sequência mínima
      return `${ano}-000001`;
    }
  }

  /* ----------------------------------------------------------
     Consultas de domínio
     ---------------------------------------------------------- */

  async function getMetricas() {
    const [docs, emps] = await Promise.all([
      list('documentos'),
      list('emprestimos'),
    ]);

    const hoje = new Date().toISOString().slice(0, 10);
    const documentos = docs || [];
    const emprestimos = emps || [];

    const ativos = emprestimos.filter(e => e.status === 'ativo');
    const atrasados = ativos.filter(e => e.data_devolucao_prevista && e.data_devolucao_prevista < hoje);

    // Prazo de guarda vencido e ainda não descartado
    const paraDescarte = documentos.filter(
      d => d.prazo_guarda && d.prazo_guarda <= hoje && d.status !== 'descartado'
    );

    const noAcervo = documentos.filter(d => d.status !== 'descartado');

    return {
      total: noAcervo.length,
      emprestados: ativos.length,
      atrasados: atrasados.length,
      paraDescarte: paraDescarte.length,
      documentos,
      emprestimos,
    };
  }

  async function searchDocumentos(filtros = {}) {
    let q = '';
    const parts = [];

    if (filtros.texto) {
      const t = encodeURIComponent(`%${filtros.texto}%`);
      parts.push(`or(protocolo.ilike.${t},descricao.ilike.${t},codigo.ilike.${t})`);
    }
    if (filtros.setor) parts.push(`setor=eq.${encodeURIComponent(filtros.setor)}`);
    if (filtros.status) parts.push(`status=eq.${encodeURIComponent(filtros.status)}`);
    if (filtros.tipo) parts.push(`tipo.ilike.${encodeURIComponent(`%${filtros.tipo}%`)}`);

    if (parts.length) q = '&' + parts.join('&');
    return request('GET', `/rest/v1/documentos?select=*,caixas(codigo,sala:salas(codigo),estante:estantes(codigo),prateleira:prateleiras(codigo))${q}&order=created_at.desc`);
  }

  /* ----------------------------------------------------------
     Gestão de usuários (somente administrador - validado na RPC/RLS)
     ---------------------------------------------------------- */

  const listarUsuarios = () => list('usuarios', '&order=email');

  const criarUsuario = ({ email, nome, senha, perfil }) =>
    request('POST', '/rest/v1/rpc/criar_usuario', {
      p_email: email, p_nome: nome, p_senha: senha, p_perfil: perfil,
    });

  const alterarPerfil = (id, perfil) => update('usuarios', id, { perfil });

  const alterarSenha = (id, senha) =>
    request('POST', '/rest/v1/rpc/alterar_senha', { p_id: id, p_senha: senha });

  const excluirUsuario = id =>
    request('POST', '/rest/v1/rpc/excluir_usuario', { p_id: id });

  /* ----------------------------------------------------------
     Auditoria (rastreabilidade)
     ---------------------------------------------------------- */

  /**
   * Registra um evento de autenticação (LOGIN/LOGOUT).
   * Nunca lança erro: auditoria não pode quebrar o fluxo principal.
   */
  async function registrarEvento(acao) {
    try {
      const user = getStoredUser();
      if (!user || !user.id) return;
      await request('POST', '/rest/v1/auditoria', {
        usuario_id: user.id,
        usuario_email: user.email || null,
        usuario_perfil: user.perfil || null,
        tabela: 'auth',
        acao,
        registro_id: user.id,
        dados_antes: null,
        dados_depois: null,
      }, { silent401: true });
    } catch { /* silencioso por design */ }
  }

  /** Lista eventos da auditoria (admin). Devolve { itens, temMais }. */
  async function listarAuditoria(f = {}) {
    const limit = f.limite || 50;
    const parts = ['order=criado_em.desc', `limit=${limit + 1}`];
    if (f.usuarioId) parts.push(`usuario_id=eq.${encodeURIComponent(f.usuarioId)}`);
    if (f.tabela) parts.push(`tabela=eq.${encodeURIComponent(f.tabela)}`);
    if (f.acao) parts.push(`acao=eq.${encodeURIComponent(f.acao)}`);
    if (f.offset) parts.push(`offset=${f.offset}`);

    const rows = await request('GET', `/rest/v1/auditoria?select=*&${parts.join('&')}`);
    const itens = rows || [];
    return { itens: itens.slice(0, limit), temMais: itens.length > limit };
  }

  return {
    getSession,
    login,
    logout,
    getStoredUser,
    PERFIS,
    list,
    insert,
    update,
    remove,
    gerarProtocolo,
    getMetricas,
    searchDocumentos,
    listarUsuarios,
    criarUsuario,
    alterarPerfil,
    alterarSenha,
    excluirUsuario,
    registrarEvento,
    listarAuditoria,
    request,
  };
})();
