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

  /**
   * Versão dos arquivos JS. Precisa ser IGUAL à VERSAO_APP de app.js:
   * se o navegador servir um arquivo antigo (cache), app.js detecta a
   * diferença e avisa o usuário para dar Ctrl+F5. Ao alterar qualquer
   * JS/CSS, incrementar também o ?v= nos HTML.
   */
  const versao = '20260929.18';

  /* ----------------------------------------------------------
     Helpers internos
     ---------------------------------------------------------- */

  /**
   * SEGURANCA: remove os caracteres reservados do PostgREST
   * ( ' ' viram separador de lista e '(' ')' delimitam expressoes
   * logicas como or(...) ). O encodeURIComponent NAO escapa '(' e ')',
   * entao um valor vindo do usuario podia quebrar/alterar a sintaxe
   * do filtro (injecao PostgREST). Toda montagem de query por
   * concatenacao deve passar os valores por aqui antes de codificar.
   */
  function filtroSeguro(valor) {
    return String(valor === null || valor === undefined ? '' : valor)
      .replace(/[(),*]/g, ' ')
      .trim();
  }

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
      let body = null;
      try {
        body = await res.json();
      } catch { /* corpo não-JSON */ }
      const detail = body && (body.message || body.error_description || body.error || '');

      // Sessão expirada / inválida
      if (res.status === 401) {
        clearSession();
        if (!options.silent401) {
          window.location.href = 'index.html';
        }
      }
      const erro = new Error(detail || `Erro ${res.status}: ${res.statusText}`);
      // PostgREST expõe o código SQL (ex.: 23505 = unique_violation)
      erro.status = res.status;
      erro.code = (body && body.code) || '';
      throw erro;
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
      // SEGURANÇA (anti-enumeração, item 10 / P5): TODA falha de
      // credencial devolve a MESMA mensagem genérica. Mensagens
      // distintas ("e-mail não confirmado", "usuário inexistente")
      // confirmariam que a conta existe e permitiriam enumeração.
      if (/invalid login credentials|email not confirmed/i.test(msg)) {
        msg = 'E-mail ou senha incorretos.';
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
      const rows = await request('GET', `/rest/v1/usuarios?id=eq.${encodeURIComponent(filtroSeguro(authUser.id))}&select=id,email,nome,perfil`, undefined, { silent401: true });
      if (rows && rows.length) return rows[0];
    } catch { /* tabela pode não existir ainda */ }
    return null;
  }

  /**
   * SEGURANCA: revalida a sessão e o perfil NO SERVIDOR.
   * O conteúdo de localStorage (sga_user) é editável pelo próprio
   * usuário, então nunca pode ser a única fonte de autorização.
   *
   * Retorno:
   *  - objeto  -> perfil atualizado (já persistido em localStorage)
   *  - false   -> acesso revogado (sem linha ou perfil inválido)
   *  - null    -> falha de transporte/rede (mantém a sessão atual)
   */
  async function revalidarPerfil() {
    const session = getSession();
    const guardado = getStoredUser();
    if (!session || !guardado || !guardado.id) return false;
    try {
      const rows = await request(
        'GET',
        `/rest/v1/usuarios?id=eq.${encodeURIComponent(filtroSeguro(guardado.id))}&select=id,email,nome,perfil`,
        undefined,
        { silent401: true }
      );
      if (!rows || !rows.length) return false;
      const atual = rows[0];
      if (!PERFIS.includes(atual.perfil)) return false;
      localStorage.setItem(SGA_CONFIG.STORAGE_USER, JSON.stringify(atual));
      return atual;
    } catch (err) {
      // 401/403 = token rejeitado ou RLS negou -> revoga.
      // Demais erros (rede, 5xx) -> não derruba sessão válida.
      return /Erro 40[13]/.test((err && err.message) || '') ? false : null;
    }
  }

  /* ----------------------------------------------------------
     CRUD genérico
     ---------------------------------------------------------- */

  /**
   * P8 — consulta menos expostiva: o 3º parâmetro declara as colunas
   * que a tela realmente usa (em vez de `select=*`). `query` mantém
   * filtros/order/limit. O select é literal do código (nunca input
   * do usuário), por isso não é codificado.
   */
  const list = (table, query = '', select = '*') =>
    request('GET', `/rest/v1/${table}?select=${select}${query}`);
  const insert = (table, data) =>
    request('POST', `/rest/v1/${table}`, data, { headers: { Prefer: 'return=representation' } });
  const update = (table, id, data) =>
    request('PATCH', `/rest/v1/${table}?id=eq.${encodeURIComponent(filtroSeguro(id))}`, data, {
      headers: { Prefer: 'return=representation' },
    });
  const remove = (table, id) =>
    request('DELETE', `/rest/v1/${table}?id=eq.${encodeURIComponent(filtroSeguro(id))}`);

  /* ----------------------------------------------------------
     Protocolo: 2026-000001 (ano + sequência de 6 dígitos)
     Números são reservados SOMENTE pelo banco (SQL atômico,
     ver sql/09_gerar_protocolo.sql). Não há MAX+1 no cliente:
     era essa leitura concorrente que gerava número repetido
     e sequência fora de ordem.
     ---------------------------------------------------------- */
  async function gerarProtocolo() {
    const r = await request('POST', '/rest/v1/rpc/gerar_protocolo', {});
    if (!r || !/^\d{4}-\d{6}$/.test(String(r))) {
      throw new Error('RPC gerar_protocolo ausente. Execute sql/09_gerar_protocolo.sql no banco.');
    }
    return String(r);
  }

  /** Próximo número do ano — apenas para exibição, NÃO consome a sequência. */
  async function proximoProtocolo() {
    try {
      const r = await request('POST', '/rest/v1/rpc/proximo_protocolo', {});
      return r && /^\d{4}-\d{6}$/.test(String(r)) ? String(r) : null;
    } catch {
      return null;
    }
  }

  /* ----------------------------------------------------------
     Consultas de domínio
     ---------------------------------------------------------- */

  async function getMetricas() {
    const [docs, emps] = await Promise.all([
      // só as colunas consumidas pelo painel (métricas + tabelas resumo)
      list('documentos', '', 'protocolo,descricao,setor,status,prazo_guarda,created_at'),
      list('emprestimos', '', 'documento_id,doc_protocolo,solicitante_nome,status,data_devolucao_prevista'),
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
    const parts = [];

    // Formato obrigatório do PostgREST: coluna=operador.valor.
    // "coluna.operador.valor" (sem '=') é ignorado silenciosamente
    // e devolve TODOS os registros.
    if (filtros.protocolo) {
      const t = encodeURIComponent(`%${filtroSeguro(filtros.protocolo)}%`);
      parts.push(`protocolo=ilike.${t}`);
    }
    if (filtros.descricao) {
      const t = encodeURIComponent(`%${filtroSeguro(filtros.descricao)}%`);
      parts.push(`descricao=ilike.${t}`);
    }
    if (filtros.setor) parts.push(`setor=eq.${encodeURIComponent(filtroSeguro(filtros.setor))}`);
    if (filtros.status) parts.push(`status=eq.${encodeURIComponent(filtroSeguro(filtros.status))}`);

    const q = parts.length ? '&' + parts.join('&') : '';
    const cols = 'id,protocolo,descricao,tipo,setor,categoria,data_documento,prazo_guarda,caixa_id,status,observacoes,'
      + 'caixas(codigo,sala:salas(codigo),estante:estantes(codigo),prateleira:prateleiras(codigo))';
    return request('GET', `/rest/v1/documentos?select=${cols}${q}&order=created_at.desc`);
  }

  /* ----------------------------------------------------------
     Gestão de usuários (somente administrador - validado na RPC/RLS)
     ---------------------------------------------------------- */

  const listarUsuarios = () =>
    list('usuarios', '&order=email&limit=500', 'id,email,nome,perfil,created_at');

  const criarUsuario = ({ email, nome, senha, perfil }) =>
    request('POST', '/rest/v1/rpc/criar_usuario', {
      p_email: email, p_nome: nome, p_senha: senha, p_perfil: perfil,
    });

  /**
   * SEGURANÇA: vai para a RPC alterar_perfil (sql/06_alterar_perfil.sql),
   * que valida admin, impede alterar o próprio perfil e mantém sempre
   * >= 1 administrador. Um UPDATE direto seria contornável pela RLS de
   * admin e permitiria rebaixar o último administrador (lockout).
   */
  const alterarPerfil = (id, perfil) =>
    request('POST', '/rest/v1/rpc/alterar_perfil', { p_id: id, p_perfil: perfil });

  const alterarSenha = (id, senha) =>
    request('POST', '/rest/v1/rpc/alterar_senha', { p_id: id, p_senha: senha });

  const excluirUsuario = id =>
    request('POST', '/rest/v1/rpc/excluir_usuario', { p_id: id });

  /* ----------------------------------------------------------
     Auditoria (rastreabilidade)
     ---------------------------------------------------------- */

  /**
   * Registra um evento de autenticação (LOGIN/LOGOUT).
   * SEGURANÇA: o cliente envia SOMENTE a ação. usuario_id,
   * usuario_email e usuario_perfil são preenchidos NO SERVIDOR
   * pela RPC registrar_evento_auth (a partir de auth.uid() +
   * public.usuarios) — impossível forjar um LOGIN com identidade
   * falsa (sql/05_auditoria_auth.sql; o INSERT direto em
   * public.auditoria está revogado).
   * Nunca lança erro: auditoria não pode quebrar o fluxo principal.
   */
  async function registrarEvento(acao) {
    try {
      const acaoSegura = String(acao || '').toUpperCase();
      if (acaoSegura !== 'LOGIN' && acaoSegura !== 'LOGOUT') return;
      if (!getSession()) return;
      await request('POST', '/rest/v1/rpc/registrar_evento_auth', {
        p_acao: acaoSegura,
      }, { silent401: true });
    } catch { /* silencioso por design */ }
  }

  /** Lista eventos da auditoria (admin). Devolve { itens, temMais }. */
  async function listarAuditoria(f = {}) {
    const limit = f.limite || 50;
    const parts = ['order=criado_em.desc', `limit=${limit + 1}`];
    if (f.usuarioId) parts.push(`usuario_id=eq.${encodeURIComponent(filtroSeguro(f.usuarioId))}`);
    if (f.tabela) parts.push(`tabela=eq.${encodeURIComponent(filtroSeguro(f.tabela))}`);
    if (f.acao) parts.push(`acao=eq.${encodeURIComponent(filtroSeguro(f.acao))}`);
    if (f.offset) parts.push(`offset=${f.offset}`);

    const rows = await request(
      'GET',
      `/rest/v1/auditoria?select=id,criado_em,usuario_email,usuario_perfil,tabela,acao,registro_id,dados_antes,dados_depois&${parts.join('&')}`
    );
    const itens = rows || [];
    return { itens: itens.slice(0, limit), temMais: itens.length > limit };
  }

  return {
    versao,
    getSession,
    login,
    logout,
    getStoredUser,
    revalidarPerfil,
    PERFIS,
    list,
    insert,
    update,
    remove,
    gerarProtocolo,
    proximoProtocolo,
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
