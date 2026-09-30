/**
 * SGA - Aplicação principal
 * Contém: utilitários, tela de login e todo o painel (menu lateral,
 * painel de métricas, pesquisa, cadastro, empréstimo/devolução e relatórios).
 *
 * Observação sobre o "Where's Waldo": nada de frameworks — JS puro ES6+.
 */
(() => {
  'use strict';

  /** Deve ser igual a SGA_API.versao (assets/js/api.js). */
  const VERSAO_APP = '20260929.20';

  /* ============================================================
     UTILITÁRIOS
     ============================================================ */
  const U = {
    /** Escapa texto para evitar XSS ao injetar em innerHTML. */
    esc(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },

    /** dd/mm/aaaa a partir de YYYY-MM-DD */
    fmtData(iso) {
      if (!iso) return '—';
      const [a, m, d] = iso.slice(0, 10).split('-');
      return d && m && a ? `${d}/${m}/${a}` : iso;
    },

    hoje() {
      return new Date().toISOString().slice(0, 10);
    },

    /** Nome amigável do status */
    statusLabel(s) {
      const map = {
        disponivel: 'Disponível',
        emprestado: 'Emprestado',
        descartavel: 'Descartável',
        descartado: 'Descartado',
        ativo: 'Ativo',
        atrasado: 'Atrasado',
        devolvido: 'Devolvido',
      };
      return map[s] || s || '—';
    },

    pill(s) {
      return `<span class="status status-${U.esc(s)}">${U.esc(U.statusLabel(s))}</span>`;
    },

    /** Validação de e-mail (RFC básica) */
    isEmail(v) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    },

    /** Mostra erro em um campo */
    setError(inputId, msg) {
      const input = document.getElementById(inputId);
      const err = document.getElementById(`error-${inputId}`);
      if (input) input.classList.toggle('invalid', !!msg);
      if (err) err.textContent = msg || '';
    },

    /** Limpa todos os erros de um formulário */
    clearErrors(form) {
      if (!form) return;
      form.querySelectorAll('.field-error').forEach(e => (e.textContent = ''));
      form.querySelectorAll('.invalid').forEach(e => e.classList.remove('invalid'));
    },

    /** Toast/notificação */
    toast(msg, type = 'info', ms = 4000) {
      const box = document.getElementById('toast-container');
      if (!box) { alert(msg); return; }
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.setAttribute('role', 'status');
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(() => {
        el.classList.add('hide');
        setTimeout(() => el.remove(), 350);
      }, ms);
    },

    /** Seta estado "loading" em botão */
    loading(btn, on) {
      if (!btn) return;
      btn.classList.toggle('loading', !!on);
      btn.disabled = !!on;
    },

    /** Localização legível de uma caixa */
    locLabel(caixa) {
      if (!caixa) return '—';
      const sala = caixa.sala?.codigo || '—';
      const est = caixa.estante?.codigo || '';
      const prat = caixa.prateleira?.codigo || '';
      return [caixa.codigo, sala, est && `E${est.replace(/^E/, '')}`, prat].filter(Boolean).join(' / ');
    },
  };

  /* ============================================================
     MODAL
     ============================================================ */
  const Modal = {
    overlay: null,
    init() {
      this.overlay = document.getElementById('modal-overlay');
      document.getElementById('modal-close').addEventListener('click', () => this.close());
      document.getElementById('modal-btn-close').addEventListener('click', () => this.close());
      this.overlay.addEventListener('click', e => {
        if (e.target === this.overlay) this.close();
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this.overlay && !this.overlay.hidden) this.close();
      });
    },
    open(title, bodyHtml, footerHtml) {
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').innerHTML = bodyHtml;
      const footer = document.getElementById('modal-footer');
      footer.innerHTML = footerHtml || '<button class="btn btn-ghost" id="modal-btn-close">Fechar</button>';
      // rebind do botão padrão (footer recriado)
      const btn = document.getElementById('modal-btn-close');
      if (btn) btn.addEventListener('click', () => this.close());
      this.overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    },
    close() {
      if (!this.overlay) return;
      this.overlay.hidden = true;
      document.body.style.overflow = '';
    },
  };

  /* ============================================================
     TELA DE LOGIN
     ============================================================ */
  function initLogin() {
    const form = document.getElementById('form-login');
    if (!form) return;

    // Se já há sessão válida com perfil, vai direto ao painel
    if (SGA_API.getSession()) {
      const guardado = SGA_API.getStoredUser();
      if (guardado && SGA_API.PERFIS.includes(guardado.perfil)) {
        window.location.replace('dashboard.html');
        return;
      }
      // Sessão sem perfil válido: encerra para não criar loop de redirecionamento
      SGA_API.logout();
    }

    const emailEl = document.getElementById('login-email');
    const passEl = document.getElementById('login-password');
    const alertEl = document.getElementById('login-alert');
    const btn = document.getElementById('btn-login');
    const remember = document.getElementById('login-remember');

    // Aviso de sessão encerrada por inatividade (definido no painel)
    try {
      if (sessionStorage.getItem('sga_timeout') === '1') {
        sessionStorage.removeItem('sga_timeout');
        alertEl.textContent = 'Sessão encerrada por inatividade. Entre novamente.';
        alertEl.hidden = false;
      }
    } catch { /* storage indisponível */ }

    // Mostrar/ocultar senha
    const eyeBtn = document.getElementById('btn-toggle-pass');
    eyeBtn.addEventListener('click', () => {
      const showing = passEl.type === 'text';
      passEl.type = showing ? 'password' : 'text';
      eyeBtn.querySelector('.eye-open').style.display = showing ? '' : 'none';
      eyeBtn.querySelector('.eye-closed').style.display = showing ? 'none' : '';
      eyeBtn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(form);
      alertEl.hidden = true;

      let ok = true;
      const email = emailEl.value.trim();
      const pass = passEl.value;

      if (!email) { U.setError('login-email', 'Informe o e-mail.'); ok = false; }
      else if (!U.isEmail(email)) { U.setError('login-email', 'E-mail inválido.'); ok = false; }

      if (!pass) { U.setError('login-password', 'Informe a senha.'); ok = false; }
      else if (pass.length < 6) { U.setError('login-password', 'Mínimo de 6 caracteres.'); ok = false; }

      if (!ok) return;

      U.loading(btn, true);
      try {
        await SGA_API.login(email, pass);
        if (remember.checked) {
          localStorage.setItem(SGA_CONFIG.STORAGE_REMEMBER, '1');
        }
        await SGA_API.registrarEvento('LOGIN');
        window.location.href = 'dashboard.html';
      } catch (err) {
        alertEl.textContent = err.message || 'Não foi possível entrar.';
        alertEl.hidden = false;
        U.loading(btn, false);
      }
    });
  }

  /* ============================================================
     PAINEL (dashboard.html)
     ============================================================ */
  async function initApp() {
    const content = document.getElementById('content');
    if (!content) return; // não é a página do painel

    // ---- Guarda de sessão ----
    const session = SGA_API.getSession();
    let user = SGA_API.getStoredUser();
    if (!session || !user) {
      window.location.replace('index.html');
      return;
    }

    // ---- Perfil válido (admin | arquivista) ----
    if (!SGA_API.PERFIS.includes(user.perfil)) {
      SGA_API.logout().finally(() => window.location.replace('index.html'));
      return;
    }

    // ---- SEGURANÇA: revalida perfil no servidor (localStorage é
    //      editável pelo usuário e não pode ser fonte de autorização) ----
    try {
      const atual = await SGA_API.revalidarPerfil();
      if (atual === false) {
        await SGA_API.logout();
        window.location.replace('index.html');
        return;
      }
      if (atual) user = atual;
    } catch { /* falha de transporte: mantém a sessão */ }

    // ---- Dados do usuário na sidebar ----
    document.getElementById('user-name').textContent = user.nome || user.email || 'Usuário';
    document.getElementById('user-role').textContent = user.perfil || '—';
    document.getElementById('user-avatar').textContent = (user.nome || user.email || 'U').charAt(0).toUpperCase();

    // ---- Data no topbar ----
    document.getElementById('topbar-date').textContent = new Date().toLocaleDateString('pt-BR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });

    Modal.init();
    setupSidebar();
    applyMenuPermissions(user.perfil);
    setupMenu();
    setupTabs();

    // Carrega a seção inicial
    loadSection('painel');

    // Sair
    document.getElementById('btn-logout').addEventListener('click', async () => {
      if (!confirm('Deseja realmente sair do sistema?')) return;
      await SGA_API.registrarEvento('LOGOUT');
      await SGA_API.logout();
      window.location.href = 'index.html';
    });

    // ---- SEGURANÇA: encerra a sessão por inatividade ----
    // Usa SGA_CONFIG.SESSION_TIMEOUT (antes declarado e nunca aplicado).
    let ultimoEvento = Date.now();
    let encerrando = false;
    const marcarEvento = () => { ultimoEvento = Date.now(); };
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt =>
      document.addEventListener(evt, marcarEvento, { passive: true })
    );
    setInterval(async () => {
      if (encerrando || Date.now() - ultimoEvento < SGA_CONFIG.SESSION_TIMEOUT) return;
      encerrando = true;
      try { await SGA_API.registrarEvento('LOGOUT'); } catch { /* ignore */ }
      await SGA_API.logout();
      try { sessionStorage.setItem('sga_timeout', '1'); } catch { /* ignore */ }
      window.location.href = 'index.html';
    }, 60 * 1000);
  }

  /* ---------- Sidebar (mobile) ---------- */
  function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggle = document.getElementById('btn-menu-toggle');
    const close = document.getElementById('sidebar-close');

    const open = () => { sidebar.classList.add('open'); overlay.classList.add('show'); };
    const shut = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

    toggle.addEventListener('click', open);
    close.addEventListener('click', shut);
    overlay.addEventListener('click', shut);
  }

  /* ---------- Menu lateral / navegação de seções ---------- */
  // Perfis válidos do sistema: admin e arquivista.
  // admin: tudo. arquivista: tudo, menos Usuários e Auditoria.
  const SECOES = {
    painel:     { titulo: 'Painel',               perfis: ['admin', 'arquivista'] },
    pesquisa:   { titulo: 'Pesquisa',             perfis: ['admin', 'arquivista'] },
    cadastro:   { titulo: 'Cadastro',             perfis: ['admin', 'arquivista'] },
    emprestimo: { titulo: 'Empréstimo / Devolução', perfis: ['admin', 'arquivista'] },
    temporalidade: { titulo: 'Temporalidade',      perfis: ['admin', 'arquivista'] },
    relatorio:  { titulo: 'Relatórios',           perfis: ['admin', 'arquivista'] },
    usuarios:   { titulo: 'Usuários',             perfis: ['admin'] },
    auditoria:  { titulo: 'Auditoria',            perfis: ['admin'] },
  };

  let currentSection = 'painel';

  /** A seção existe e o perfil tem permissão? */
  function podeAcessar(secao, perfil) {
    const s = SECOES[secao];
    return !!s && s.perfis.includes(perfil);
  }

  /** Remove do menu as seções que o perfil não pode ver. */
  function applyMenuPermissions(perfil) {
    document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
      if (!podeAcessar(btn.dataset.section, perfil)) btn.remove();
    });
  }

  function setupMenu() {
    document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
      btn.addEventListener('click', () => loadSection(btn.dataset.section));
    });
  }

  function loadSection(name) {
    const perfil = (SGA_API.getStoredUser() || {}).perfil;
    if (!podeAcessar(name, perfil)) {
      U.toast('Você não tem permissão para acessar esta seção.', 'warning');
      name = 'painel';
    }
    currentSection = name;

    // Menu ativo
    document.querySelectorAll('.nav-item[data-section]').forEach(b => {
      b.classList.toggle('active', b.dataset.section === name);
    });

    // Seções visíveis
    document.querySelectorAll('.section').forEach(s => {
      s.classList.toggle('active', s.id === `section-${name}`);
    });

    document.getElementById('section-title').textContent = (SECOES[name] || {}).titulo || name;

    // Fecha sidebar no mobile
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');

    // Carrega dados da seção
    switch (name) {
      case 'painel': loadPainel(); break;
      case 'pesquisa': initPesquisaOnce(); break;
      case 'cadastro': initCadastroOnce(); break;
      case 'emprestimo':
        initEmprestimoOnce();
        loadEmprestimoData();
        break;
      case 'temporalidade':
        loadTemporalidade();
        break;
      case 'relatorio':
        initRelatorioOnce();
        break;
      case 'usuarios':
        initUsuariosOnce();
        loadUsuarios();
        break;
      case 'auditoria':
        initAuditoriaOnce();
        loadAuditoria(true);
        break;
    }
  }

  /* ---------- Abas ---------- */
  function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const parent = tab.closest('.section');
        parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });
  }

  /* ============================================================
     SEÇÃO: PAINEL (métricas + tabelas resumo)
     ============================================================ */
  async function loadPainel() {
    try {
      const m = await SGA_API.getMetricas();

      document.getElementById('metric-total').textContent = m.total;
      document.getElementById('metric-emprestados').textContent = m.emprestados;
      document.getElementById('metric-atrasados').textContent = m.atrasados;
      document.getElementById('metric-descarte').textContent = m.paraDescarte;

      // Últimos documentos
      const recentes = [...m.documentos]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5);

      const tbodyDoc = document.querySelector('#table-recentes tbody');
      tbodyDoc.innerHTML = recentes.length
        ? recentes.map(d => `
            <tr>
              <td class="cell-protocolo"><strong>${U.esc(d.protocolo)}</strong></td>
              <td>${U.esc(d.descricao)}</td>
              <td>${U.esc(d.setor)}</td>
              <td>${U.pill(d.status)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="empty-state">Nenhum documento cadastrado ainda</td></tr>';

      // Empréstimos ativos
      const ativos = m.emprestimos
        .filter(e => e.status === 'ativo')
        .sort((a, b) => (a.data_devolucao_prevista || '').localeCompare(b.data_devolucao_prevista || ''))
        .slice(0, 5);

      const tbodyEmp = document.querySelector('#table-emprestimos-ativos tbody');
      tbodyEmp.innerHTML = ativos.length
        ? ativos.map(e => {
            const atrasado = e.data_devolucao_prevista && e.data_devolucao_prevista < U.hoje();
            return `
            <tr>
              <td class="cell-protocolo">${U.esc(e.doc_protocolo || e.documento_id || '—')}</td>
              <td>${U.esc(e.solicitante_nome)}</td>
              <td>${U.fmtData(e.data_devolucao_prevista)}</td>
              <td>${U.pill(atrasado ? 'atrasado' : 'ativo')}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="4" class="empty-state">Nenhum empréstimo ativo</td></tr>';

    } catch (err) {
      U.toast(`Erro ao carregar painel: ${err.message}`, 'error');
    }
  }

  /* ============================================================
     SEÇÃO: PESQUISA
     ============================================================ */
  let pesquisaInit = false;

  function initPesquisaOnce() {
    if (pesquisaInit) return;
    pesquisaInit = true;

    const form = document.getElementById('form-pesquisa');
    let seqPesquisa = 0;

    async function executarPesquisa() {
      paginaPesquisa = 1; // nova busca volta para a primeira página
      const minhaVez = ++seqPesquisa;
      const tbody = document.querySelector('#table-pesquisa tbody');
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Pesquisando…</td></tr>';

      try {
        const filtros = {
          protocolo: document.getElementById('pesq-protocolo').value.trim(),
          descricao: document.getElementById('pesq-descricao').value.trim(),
          setor: document.getElementById('pesq-setor').value,
          status: document.getElementById('pesq-status').value,
        };
        const docs = await SGA_API.searchDocumentos(filtros);
        if (minhaVez !== seqPesquisa) return; // resposta antiga, descarta
        renderPesquisa(docs || []);
      } catch (err) {
        if (minhaVez !== seqPesquisa) return;
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Erro: ${U.esc(err.message)}</td></tr>`;
        U.toast(err.message, 'error');
      }
    }

    form.addEventListener('submit', e => {
      e.preventDefault();
      executarPesquisa();
    });

    // Descrição: filtra enquanto o usuário digita (debounce 300ms)
    let timerDescricao = null;
    document.getElementById('pesq-descricao').addEventListener('input', () => {
      clearTimeout(timerDescricao);
      timerDescricao = setTimeout(executarPesquisa, 300);
    });

    document.getElementById('btn-limpar-pesquisa').addEventListener('click', () => {
      clearTimeout(timerDescricao);
      seqPesquisa++; // cancela resposta pendente
      paginaPesquisa = 1;
      form.reset();
      renderPesquisa([]);
      document.getElementById('pesquisa-count').textContent = '0';
    });

    // Redimensionar a janela muda quantas linhas cabem na tela
    let timerResize = null;
    window.addEventListener('resize', () => {
      clearTimeout(timerResize);
      timerResize = setTimeout(() => {
        if (docsPesquisa.length) renderPesquisa(docsPesquisa);
      }, 150);
    });
  }

  /* Paginação da aba Pesquisa: cada página tem o MÁXIMO de linhas que
     cabem na tela (recalculado a cada busca e no resize da janela). */
  let porPagina = 10;
  let paginaPesquisa = 1;
  let docsPesquisa = [];

  /** Espaço reservado abaixo da tabela: barra de paginação + margem. */
  const RESERVA_RODAPE = 62;

  /** Quantas linhas cabem entre o topo da tabela e o fim da tela. */
  function calcularPorPagina() {
    const tabela = document.getElementById('table-pesquisa');
    if (!tabela) return 10;
    // altura de uma linha já renderizada; senão, usa o cabeçalho
    const exemplo = tabela.querySelector('tbody td:not(.empty-state)')
      || tabela.querySelector('thead tr');
    const alturaLinha = exemplo ? exemplo.getBoundingClientRect().height : 30;
    const topo = tabela.getBoundingClientRect().top;
    const disponivel = document.documentElement.clientHeight - topo - RESERVA_RODAPE;
    const linhas = alturaLinha > 0 ? Math.floor(disponivel / alturaLinha) : 10;
    return Math.max(1, Math.min(50, linhas));
  }

  /**
   * Calcula quantas linhas cabem na tela, desenha e corrige o excesso —
   * a barra de rolagem vertical NÃO pode aparecer na aba Pesquisa.
   */
  function renderPesquisa(docs) {
    docsPesquisa = docs;
    porPagina = calcularPorPagina();
    desenharPesquisa();

    // Correção de segurança: se ainda houver estouro de altura,
    // corta linhas e redesenha (no máximo 10 rodadas).
    let rodada = 0;
    while (rodada < 10 && porPagina > 1) {
      const raiz = document.documentElement;
      const excesso = raiz.scrollHeight - raiz.clientHeight;
      if (excesso <= 0) break;
      const celula = document.querySelector('#table-pesquisa tbody td');
      const alturaLinha = celula && celula.clientHeight ? celula.clientHeight : 30;
      porPagina = Math.max(1, porPagina - Math.ceil(excesso / alturaLinha));
      desenharPesquisa();
      rodada++;
    }
  }

  /** Desenha a fatia atual (paginaPesquisa) da lista docsPesquisa. */
  function desenharPesquisa() {
    const docs = docsPesquisa;
    document.getElementById('pesquisa-count').textContent = docs.length;

    const totalPaginas = Math.max(1, Math.ceil(docs.length / porPagina));
    if (paginaPesquisa > totalPaginas) paginaPesquisa = totalPaginas;
    if (paginaPesquisa < 1) paginaPesquisa = 1;
    const inicio = (paginaPesquisa - 1) * porPagina;
    const pagina = docs.slice(inicio, inicio + porPagina);

    const tbody = document.querySelector('#table-pesquisa tbody');

    if (!docs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum documento encontrado</td></tr>';
      renderPaginacao(0);
      return;
    }

    tbody.innerHTML = pagina.map(d => `
      <tr>
        <td class="cell-protocolo"><strong>${U.esc(d.protocolo)}</strong></td>
        <td><span class="cell-desc" title="${U.esc(d.descricao)}">${U.esc(d.descricao)}</span></td>
        <td>${U.esc(d.tipo)}</td>
        <td>${U.esc(d.setor)}</td>
        <td>${U.pill(d.status)}</td>
        <td class="cell-local">${U.esc(U.locLabel(d.caixas))}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-ghost" data-view="${U.esc(d.id)}">Detalhes</button>
            <button class="btn btn-sm btn-ghost" data-editar="${U.esc(d.id)}">Editar</button>
          </div>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const doc = docs.find(x => x.id === btn.dataset.view);
        if (doc) showDocDetails(doc);
      });
    });

    tbody.querySelectorAll('[data-editar]').forEach(btn => {
      btn.addEventListener('click', () => {
        const doc = docs.find(x => x.id === btn.dataset.editar);
        if (doc) abrirEdicaoDocumento(doc);
      });
    });

    renderPaginacao(totalPaginas);
  }

  /** Renderiza os botões de página (1 … N) sob a tabela de resultados. */
  function renderPaginacao(totalPaginas) {
    const nav = document.getElementById('pesquisa-pagination');
    if (!nav) return;
    if (totalPaginas <= 1) {
      nav.innerHTML = '';
      nav.hidden = true;
      return;
    }
    nav.hidden = false;

    // Janela de páginas: todas até 9; depois 1 … x-1 x x+1 … N
    const paginas = [];
    if (totalPaginas <= 9) {
      for (let i = 1; i <= totalPaginas; i++) paginas.push(i);
    } else {
      paginas.push(1);
      const de = Math.max(2, paginaPesquisa - 2);
      const ate = Math.min(totalPaginas - 1, paginaPesquisa + 2);
      if (de > 2) paginas.push('…');
      for (let i = de; i <= ate; i++) paginas.push(i);
      if (ate < totalPaginas - 1) paginas.push('…');
      paginas.push(totalPaginas);
    }

    nav.innerHTML =
      `<button type="button" class="page-btn" data-pag="${paginaPesquisa - 1}"`
      + `${paginaPesquisa === 1 ? ' disabled' : ''} aria-label="Página anterior">&#8249;</button>`
      + paginas.map(p => p === '…'
        ? '<span class="page-ellipsis">…</span>'
        : `<button type="button" class="page-btn${p === paginaPesquisa ? ' active' : ''}"`
          + ` data-pag="${p}"${p === paginaPesquisa ? ' aria-current="page"' : ''}>${p}</button>`
      ).join('')
      + `<button type="button" class="page-btn" data-pag="${paginaPesquisa + 1}"`
      + `${paginaPesquisa >= totalPaginas ? ' disabled' : ''} aria-label="Próxima página">&#8250;</button>`;

    nav.querySelectorAll('[data-pag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const alvo = Number(btn.dataset.pag);
        if (!Number.isFinite(alvo) || alvo < 1 || alvo > totalPaginas || alvo === paginaPesquisa) return;
        paginaPesquisa = alvo;
        renderPesquisa(docsPesquisa);
        const tabela = document.getElementById('table-pesquisa');
        if (tabela) tabela.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  function showDocDetails(d) {
    const rows = [
      ['Protocolo', `<strong>${U.esc(d.protocolo)}</strong>`],
      ['Nome', U.esc(d.descricao)],
      ['Tipo', U.esc(d.tipo)],
      ['Setor', U.esc(d.setor)],
      ['Categoria', U.esc(d.categoria || '—')],
      ['Data doc.', U.fmtData(d.data_documento)],
      ['Status', U.pill(d.status)],
      ['Prazo guarda', U.fmtData(d.prazo_guarda)],
      ['Localização', U.esc(U.locLabel(d.caixas))],
      ['Observações', U.esc(d.observacoes || '—')],
    ];
    const html = rows.map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    // "Excluir" somente para administradores
    const isAdmin = (SGA_API.getStoredUser() || {}).perfil === 'admin';
    const footer = isAdmin
      ? '<button class="btn btn-danger" id="btn-excluir-doc">Excluir</button>'
        + '<button class="btn btn-ghost" id="modal-btn-close">Fechar</button>'
      : undefined; // rodapé padrão (apenas Fechar)

    Modal.open(`Documento ${d.protocolo}`, `<dl>${html}</dl>`, footer);

    const btnExcluir = document.getElementById('btn-excluir-doc');
    if (btnExcluir) btnExcluir.addEventListener('click', () => excluirDocumento(d));
  }

  /**
   * Exclui o documento do acervo (somente admin).
   * Confirmação obrigatória; a exclusão é registrada automaticamente
   * na auditoria pelo trigger trg_auditoria (sql/02_auditoria.sql).
   */
  async function excluirDocumento(d) {
    const ok = confirm(
      `Deseja realmente excluir o documento ${d.protocolo} do acervo?\n\n`
      + 'Esta ação não pode ser desfeita. O registro ficará na auditoria.'
    );
    if (!ok) return;

    try {
      await SGA_API.remove('documentos', d.id);
      U.toast(`Documento ${d.protocolo} excluído do acervo.`, 'success');
      Modal.close();
      refazerPesquisa();
    } catch (err) {
      const msg = err.code === '23503'
        ? 'Não é possível excluir: o documento tem registros vinculados (empréstimos ou arquivos).'
        : (err.message || 'Erro ao excluir o documento.');
      U.toast(msg, 'error');
    }
  }

  /* ---- Edição do documento (modal, a partir da aba Pesquisa) ---- */
  async function abrirEdicaoDocumento(d) {
    // opções de setor/categoria reutilizadas do formulário de cadastro
    const elSetor = document.getElementById('doc-setor');
    const elCategoria = document.getElementById('doc-categoria');
    const opsSetor = elSetor ? elSetor.innerHTML : '';
    const opsCategoria = elCategoria ? elCategoria.innerHTML : '';

    let caixas = [];
    try {
      caixas = await SGA_API.list('caixas', '&order=codigo&limit=500', 'id,codigo,descricao');
    } catch { /* mantém lista vazia */ }
    const opsCaixa = (caixas || [])
      .map(c => `<option value="${U.esc(c.id)}">${U.esc(c.codigo)}${c.descricao ? ' — ' + U.esc(c.descricao) : ''}</option>`)
      .join('');

    Modal.open(`Editar documento ${d.protocolo}`, `
      <form id="form-editar-doc" class="form-stack" novalidate>
        <div class="form-group">
          <label for="ed-protocolo">Protocolo</label>
          <input type="text" id="ed-protocolo" value="${U.esc(d.protocolo)}" disabled>
        </div>
        <div class="form-group">
          <label for="ed-descricao">Nome *</label>
          <input type="text" id="ed-descricao" maxlength="500" value="${U.esc(d.descricao)}">
          <span class="field-error" id="error-ed-descricao" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-tipo">Tipo *</label>
          <input type="text" id="ed-tipo" list="list-tipo" maxlength="80" value="${U.esc(d.tipo)}">
          <span class="field-error" id="error-ed-tipo" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-setor">Setor *</label>
          <select id="ed-setor">${opsSetor}</select>
          <span class="field-error" id="error-ed-setor" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-categoria">Categoria *</label>
          <select id="ed-categoria">${opsCategoria}</select>
          <span class="field-error" id="error-ed-categoria" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-data">Data do Documento *</label>
          <input type="date" id="ed-data" value="${U.esc(d.data_documento || '')}">
          <span class="field-error" id="error-ed-data" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-prazo">Prazo de Guarda (temporalidade) *</label>
          <input type="date" id="ed-prazo" value="${U.esc(d.prazo_guarda || '')}">
          <span class="field-error" id="error-ed-prazo" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-caixa">Caixa / Localização Física *</label>
          <select id="ed-caixa"><option value="">Selecione…</option>${opsCaixa}</select>
          <span class="field-error" id="error-ed-caixa" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ed-observacoes">Observações</label>
          <textarea id="ed-observacoes" rows="2" maxlength="1000">${U.esc(d.observacoes || '')}</textarea>
          <span class="field-error" id="error-ed-observacoes" role="alert"></span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="btn-salvar-edicao">Salvar</button>
          <button type="button" class="btn btn-ghost" id="btn-cancelar-edicao">Cancelar</button>
        </div>
      </form>`);

    // valores atuais nos selects
    document.getElementById('ed-setor').value = d.setor || '';
    document.getElementById('ed-categoria').value = d.categoria || '';
    document.getElementById('ed-caixa').value = d.caixa_id || '';

    const form = document.getElementById('form-editar-doc');
    document.getElementById('btn-cancelar-edicao').addEventListener('click', () => Modal.close());

    form.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(form);

      const descricao = document.getElementById('ed-descricao').value.trim();
      const tipo = document.getElementById('ed-tipo').value.trim();
      const setor = document.getElementById('ed-setor').value;
      const categoria = document.getElementById('ed-categoria').value;
      const dataDoc = document.getElementById('ed-data').value;
      const prazo = document.getElementById('ed-prazo').value;
      const caixa = document.getElementById('ed-caixa').value;
      const observacoes = document.getElementById('ed-observacoes').value.trim();

      let ok = true;
      if (!descricao) { U.setError('ed-descricao', 'O nome é obrigatório.'); ok = false; }
      if (!tipo) { U.setError('ed-tipo', 'Informe o tipo.'); ok = false; }
      if (!setor) { U.setError('ed-setor', 'Selecione o setor.'); ok = false; }
      if (!categoria) { U.setError('ed-categoria', 'Selecione a categoria.'); ok = false; }
      if (!dataDoc) { U.setError('ed-data', 'Informe a data do documento.'); ok = false; }
      if (!prazo) { U.setError('ed-prazo', 'Informe o prazo de guarda.'); ok = false; }
      if (!caixa) { U.setError('ed-caixa', 'Selecione a caixa/localização.'); ok = false; }
      if (!ok) return;

      const btn = document.getElementById('btn-salvar-edicao');
      U.loading(btn, true);
      try {
        await SGA_API.update('documentos', d.id, {
          descricao, tipo, setor, categoria,
          data_documento: dataDoc,
          prazo_guarda: prazo,
          caixa_id: caixa,
          observacoes,
        });
        U.toast(`Documento ${d.protocolo} atualizado!`, 'success');
        Modal.close();
        refazerPesquisa();
      } catch (err) {
        U.toast(err.message, 'error');
        U.loading(btn, false);
      }
    });
  }

  /**
   * Reexecuta a busca atual da aba Pesquisa mantendo a página em que o
   * usuário está (usado após Editar/Excluir um documento).
   */
  function refazerPesquisa() {
    const form = document.getElementById('form-pesquisa');
    if (!form) return;
    const pagina = paginaPesquisa;
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true }));
    paginaPesquisa = pagina; // executarPesquisa volta para a página 1; restaura
  }

  /* ============================================================
     SEÇÃO: CADASTRO
     ============================================================ */
  let cadastroInit = false;

  function initCadastroOnce() {
    if (cadastroInit) return;
    cadastroInit = true;

    // Próximo protocolo
    refreshProtocolo();

    // Próximos códigos das localizações (SL-001, C-001, ...)
    refreshCodigos();

    // ---------- Documento ----------
    const formDoc = document.getElementById('form-documento');
    formDoc.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(formDoc);

      let ok = true;
      const descricao = document.getElementById('doc-descricao').value.trim();
      const tipo = document.getElementById('doc-tipo').value.trim();
      const setor = document.getElementById('doc-setor').value;
      const categoria = document.getElementById('doc-categoria').value;
      const dataDoc = document.getElementById('doc-data').value;
      const prazo = document.getElementById('doc-prazo').value;
      const caixa = document.getElementById('doc-caixa').value;
      const observacoes = document.getElementById('doc-observacoes').value.trim();

      if (!descricao) { U.setError('doc-descricao', 'O nome é obrigatório.'); ok = false; }
      if (!tipo) { U.setError('doc-tipo', 'Informe o tipo.'); ok = false; }
      if (!setor) { U.setError('doc-setor', 'Selecione o setor.'); ok = false; }
      if (!categoria) { U.setError('doc-categoria', 'Selecione a categoria.'); ok = false; }
      if (!dataDoc) { U.setError('doc-data', 'Informe a data do documento.'); ok = false; }
      if (!prazo) { U.setError('doc-prazo', 'Informe o prazo de guarda.'); ok = false; }
      if (!caixa) { U.setError('doc-caixa', 'Selecione a caixa/localização.'); ok = false; }
      if (!ok) return;

      const btn = document.getElementById('btn-salvar-doc');
      U.loading(btn, true);

      try {
        // O protocolo é reservado NO BANCO e somente no momento do
        // salvamento. Gerar na abertura da tela deixava uma janela
        // longa entre gerar e inserir (corrida -> número repetido /
        // sequência fora de ordem).
        let protocoloSalvo = null;
        for (let tentativa = 0; tentativa < 3 && !protocoloSalvo; tentativa++) {
          const protocolo = await SGA_API.gerarProtocolo();
          try {
            await SGA_API.insert('documentos', {
              protocolo,
              descricao,
              tipo,
              setor,
              categoria,
              data_documento: dataDoc,
              prazo_guarda: prazo,
              caixa_id: caixa,
              observacoes,
              status: 'disponivel',
            });
            protocoloSalvo = protocolo;
          } catch (err) {
            // 23505 = unique_violation: outro usuário pegou o mesmo número
            if (err.code !== '23505') throw err;
          }
        }
        if (!protocoloSalvo) {
          throw new Error('Não foi possível reservar um protocolo único. Tente novamente.');
        }

        U.toast(`Documento ${protocoloSalvo} cadastrado com sucesso!`, 'success');
        formDoc.reset();
        refreshProtocolo();
        loadCaixasNoSelect();
      } catch (err) {
        U.toast(`Erro ao salvar: ${err.message}`, 'error');
      } finally {
        U.loading(btn, false);
      }
    });

    // ---------- Localizações ----------
    bindSimpleForm('form-sala', 'salas', () => {
      U.toast('Sala cadastrada!', 'success');
      loadLocalSelects();
      refreshCodigos();
    }, 'salas');

    document.getElementById('form-corredor').addEventListener('submit', async e => {
      e.preventDefault();
      const salaId = document.getElementById('corredor-sala').value;
      const capacidade = parseInt(document.getElementById('corredor-capacidade').value, 10);
      if (!salaId || !capacidade) { U.toast('Preencha sala e capacidade.', 'warning'); return; }
      try {
        const codigo = await SGA_API.gerarCodigo('corredores');
        await SGA_API.insert('corredores', {
          codigo, sala_id: salaId, capacidade,
          descricao: document.getElementById('corredor-descricao').value.trim() || null,
        });
        U.toast('Corredor cadastrado!', 'success');
        e.target.reset();
        loadLocalSelects();
        refreshCodigos();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    document.getElementById('form-estante').addEventListener('submit', async e => {
      e.preventDefault();
      const salaId = document.getElementById('estante-sala').value;
      const corredorId = document.getElementById('estante-corredor').value;
      const capacidade = parseInt(document.getElementById('estante-capacidade').value, 10);
      if (!salaId || !corredorId || !capacidade) { U.toast('Preencha sala, corredor e capacidade.', 'warning'); return; }
      try {
        const codigo = await SGA_API.gerarCodigo('estantes');
        await SGA_API.insert('estantes', {
          codigo, sala_id: salaId, corredor_id: corredorId, capacidade,
          descricao: document.getElementById('estante-descricao').value.trim() || null,
        });
        U.toast('Estante cadastrada!', 'success');
        e.target.reset();
        loadLocalSelects();
        refreshCodigos();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    // Corredores da estante: refiltra quando a sala muda
    document.getElementById('estante-sala').addEventListener('change', fillCorredoresDaSala);

    document.getElementById('form-prateleira').addEventListener('submit', async e => {
      e.preventDefault();
      const salaId = document.getElementById('prat-sala').value;
      const corredorId = document.getElementById('prat-corredor').value;
      const estanteId = document.getElementById('prat-estante').value;
      const capacidade = parseInt(document.getElementById('prat-capacidade').value, 10);
      if (!salaId || !corredorId || !estanteId || !capacidade) {
        U.toast('Preencha sala, corredor, estante e capacidade.', 'warning');
        return;
      }
      try {
        const codigo = await SGA_API.gerarCodigo('prateleiras');
        await SGA_API.insert('prateleiras', {
          codigo, estante_id: estanteId, capacidade,
          descricao: document.getElementById('prat-descricao').value.trim() || null,
        });
        U.toast('Prateleira cadastrada!', 'success');
        e.target.reset();
        loadLocalSelects();
        refreshCodigos();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    // Prateleira: cascata Sala -> Corredor -> Estante
    document.getElementById('prat-sala').addEventListener('change', () => {
      document.getElementById('prat-corredor').value = '';
      fillCorredoresDo('prat-sala', 'prat-corredor');
      fillEstantesDo('prat-sala', 'prat-corredor', 'prat-estante');
    });
    document.getElementById('prat-corredor').addEventListener('change', () => {
      fillEstantesDo('prat-sala', 'prat-corredor', 'prat-estante');
    });

    document.getElementById('form-caixa').addEventListener('submit', async e => {
      e.preventDefault();
      const salaId = document.getElementById('caixa-sala').value;
      const corredorId = document.getElementById('caixa-corredor').value;
      const estanteId = document.getElementById('caixa-estante').value;
      const prateleiraId = document.getElementById('caixa-prateleira').value;
      const capacidade = parseInt(document.getElementById('caixa-capacidade').value, 10);
      if (!salaId || !corredorId || !estanteId || !prateleiraId || !capacidade) {
        U.toast('Preencha sala, corredor, estante, prateleira e capacidade.', 'warning');
        return;
      }
      try {
        const codigo = await SGA_API.gerarCodigo('caixas');
        await SGA_API.insert('caixas', {
          codigo,
          sala_id: salaId,
          estante_id: estanteId,
          prateleira_id: prateleiraId,
          capacidade,
          descricao: null,
        });
        U.toast('Caixa cadastrada!', 'success');
        e.target.reset();
        document.getElementById('caixa-capacidade').value = 50;
        loadLocalSelects();
        loadCaixasTable();
        loadCaixasNoSelect();
        refreshCodigos();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    // Caixa: corredor da sala escolhida; estantes filtradas por sala/corredor
    document.getElementById('caixa-sala').addEventListener('change', () => {
      document.getElementById('caixa-corredor').value = '';
      fillCorredoresDo('caixa-sala', 'caixa-corredor');
      fillEstantesDo('caixa-sala', 'caixa-corredor', 'caixa-estante');
    });
    document.getElementById('caixa-corredor').addEventListener('change', () => {
      fillEstantesDo('caixa-sala', 'caixa-corredor', 'caixa-estante');
    });

    // Carregamentos iniciais
    loadLocalSelects();
    loadCaixasNoSelect();
    loadCaixasTable();
  }

  async function refreshProtocolo() {
    const preview = document.getElementById('protocolo-preview');
    try {
      // Apenas EXIBE o próximo número; quem reserva é o submit.
      const p = await SGA_API.proximoProtocolo();
      preview.textContent = p ? `Protocolo: ${p}` : 'Protocolo: gerado ao salvar';
    } catch {
      preview.textContent = 'Protocolo: gerado ao salvar';
    }
  }

  function bindSimpleForm(formId, table, onSuccess, chaveCodigo) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = {};
      form.querySelectorAll('input, select, textarea').forEach(el => {
        if (!el.id) return;
        const key = el.id.replace(/^(sala|estante|prat|caixa)-/, '');
        data[key === 'codigo' ? 'codigo' : key === 'descricao' ? 'descricao' : key] =
          el.value.trim() || null;
      });
      // Código vem da sequência do banco (campo somente leitura na tela)
      if (!chaveCodigo && !data.codigo) { U.toast('Informe o código.', 'warning'); return; }
      if ('capacidade' in data && !data.capacidade) { U.toast('Informe a capacidade.', 'warning'); return; }
      if (chaveCodigo) {
        try {
          data.codigo = await SGA_API.gerarCodigo(chaveCodigo);
        } catch (err) {
          U.toast(err.message, 'error');
          return;
        }
      }
      try {
        await SGA_API.insert(table, data);
        form.reset();
        onSuccess && onSuccess();
      } catch (err) {
        U.toast(err.message, 'error');
      }
    });
  }

  /**
   * Exibe nos campos de Código (somente leitura) o proximo codigo
   * de cada sequencia (SL-001, C-001, E-001, P-0001, CX-000001).
   * Apenas visualizacao: quem consome e' o submit (gerar_codigo).
   */
  async function refreshCodigos() {
    const mapa = [
      ['sala-codigo', 'salas'],
      ['corredor-codigo', 'corredores'],
      ['estante-codigo', 'estantes'],
      ['prat-codigo', 'prateleiras'],
      ['caixa-codigo', 'caixas'],
    ];
    await Promise.all(mapa.map(async ([id, chave]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const cod = await SGA_API.proximoCodigo(chave);
      if (cod) el.value = cod;
    }));
  }

  let corredoresCache = [];
  let estantesCache = [];

  async function loadLocalSelects() {
    try {
      const [salas, estantes, prat, corr] = await Promise.all([
        SGA_API.list('salas', '&order=codigo&limit=500', 'id,codigo,descricao'),
        // corredor_id so existe apos o 10_corredores.sql; sem ele, refaz sem a coluna
        SGA_API.list('estantes', '&order=codigo&limit=500', 'id,codigo,descricao,sala_id,corredor_id')
          .catch(() => SGA_API.list('estantes', '&order=codigo&limit=500', 'id,codigo,descricao,sala_id').catch(() => [])),
        SGA_API.list('prateleiras', '&order=codigo&limit=500', 'id,codigo,descricao'),
        // tabela nova: se ainda não existe no banco, segue com lista vazia
        SGA_API.list('corredores', '&order=codigo&limit=500', 'id,codigo,descricao,sala_id').catch(() => []),
      ]);

      corredoresCache = corr || [];
      estantesCache = estantes || [];

      fillSelect('estante-sala', salas, 'Selecione a sala…');
      fillSelect('caixa-sala', salas, 'Selecione a sala…');
      fillSelect('corredor-sala', salas, 'Selecione a sala…');
      fillSelect('prat-sala', salas, 'Selecione a sala…');

      fillSelect('caixa-prateleira', prat, 'Selecione…');

      fillCorredoresDaSala();
      fillCorredoresDo('prat-sala', 'prat-corredor');
      fillEstantesDo('prat-sala', 'prat-corredor', 'prat-estante');
      fillCorredoresDo('caixa-sala', 'caixa-corredor');
      fillEstantesDo('caixa-sala', 'caixa-corredor', 'caixa-estante');
    } catch (err) {
      // silencioso no carregamento inicial (tabelas podem ainda não existir)
      console.warn('loadLocalSelects:', err.message);
    }
  }

  /**
   * Preenche o select de corredores da estante apenas com os
   * corredores da sala selecionada (reset na troca de sala).
   */
  function fillCorredoresDaSala() {
    const selCorr = document.getElementById('estante-corredor');
    if (selCorr) selCorr.value = '';
    fillCorredoresDo('estante-sala', 'estante-corredor');
  }

  /** Select de corredores de um formulario: filtrado pela sala escolhida. */
  function fillCorredoresDo(salaSelId, corrSelId) {
    const selSala = document.getElementById(salaSelId);
    const selCorr = document.getElementById(corrSelId);
    if (!selSala || !selCorr) return;
    const salaId = selSala.value;
    const ops = corredoresCache.filter(c => String(c.sala_id) === String(salaId));
    fillSelect(corrSelId, ops, 'Selecione o corredor…');
  }

  /**
   * Select de estantes de um formulario: os da sala escolhida; com
   * corredor selecionado, os daquele corredor (mais as ainda sem corredor).
   */
  function fillEstantesDo(salaSelId, corrSelId, estSelId) {
    const selSala = document.getElementById(salaSelId);
    const selCorr = document.getElementById(corrSelId);
    const selEst = document.getElementById(estSelId);
    if (!selSala || !selCorr || !selEst) return;
    const salaId = selSala.value;
    const corredorId = selCorr.value;
    const ops = estantesCache.filter(e =>
      String(e.sala_id) === String(salaId) &&
      (!corredorId || !e.corredor_id || String(e.corredor_id) === String(corredorId)));
    fillSelect(estSelId, ops, 'Selecione a estante…');
  }

  function fillSelect(id, rows, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${U.esc(placeholder)}</option>` +
      (rows || []).map(r => `<option value="${U.esc(r.id)}">${U.esc(r.codigo)}${r.descricao ? ' — ' + U.esc(r.descricao) : ''}</option>`).join('');
    if (current) sel.value = current;
    // valor antigo não existe mais (ex.: troca de filtro): volta ao placeholder
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
  }

  async function loadCaixasNoSelect() {
    try {
      const caixas = await SGA_API.list('caixas', '&order=codigo&limit=500', 'id,codigo,descricao');
      fillSelect('doc-caixa', caixas, 'Selecione a caixa…');
    } catch { /* ignore */ }
  }

  async function loadCaixasTable() {
    try {
      const caixas = await SGA_API.list(
        'caixas',
        '&order=codigo&limit=500',
        'id,codigo,capacidade,descricao,sala:salas(codigo),estante:estantes(codigo),prateleira:prateleiras(codigo)'
      );
      const tbody = document.querySelector('#table-caixas tbody');
      if (!caixas || !caixas.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma caixa cadastrada</td></tr>';
        return;
      }
      tbody.innerHTML = caixas.map(c => `
        <tr>
          <td><strong>${U.esc(c.codigo)}</strong></td>
          <td>${U.esc(c.sala?.codigo || '—')}</td>
          <td>${U.esc(c.estante?.codigo || '—')}</td>
          <td>${U.esc(c.prateleira?.codigo || '—')}</td>
          <td>${U.esc(c.capacidade ?? '—')}</td>
        </tr>`).join('');
    } catch { /* ignore */ }
  }

  /* ============================================================
     SEÇÃO: EMPRÉSTIMO / DEVOLUÇÃO
     ============================================================ */
  let emprestimoInit = false;
  let docsDisponiveis = [];
  let emprestimosAtivos = [];

  function initEmprestimoOnce() {
    if (emprestimoInit) return;
    emprestimoInit = true;

    // Datas padrão
    document.getElementById('emp-data-emprestimo').value = U.hoje();
    const prev = new Date();
    prev.setDate(prev.getDate() + 7);
    document.getElementById('emp-data-prevista').value = prev.toISOString().slice(0, 10);

    const form = document.getElementById('form-emprestimo');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(form);

      let ok = true;
      const docId = document.getElementById('emp-doc').value;
      const solicitante = document.getElementById('emp-solicitante').value.trim();
      const dtEmp = document.getElementById('emp-data-emprestimo').value;
      const dtPrev = document.getElementById('emp-data-prevista').value;

      if (!docId) { U.setError('emp-doc', 'Selecione o documento.'); ok = false; }
      if (!solicitante) { U.setError('emp-solicitante', 'Informe o solicitante.'); ok = false; }
      if (!dtEmp || !dtPrev) { U.setError('emp-data-prevista', 'Informe as datas.'); ok = false; }
      else if (dtPrev < dtEmp) { U.setError('emp-data-prevista', 'Deve ser ≥ data do empréstimo.'); ok = false; }
      if (!ok) return;

      const btn = document.getElementById('btn-salvar-emp');
      U.loading(btn, true);

      try {
        const doc = docsDisponiveis.find(d => d.id === docId);
        await SGA_API.insert('emprestimos', {
          documento_id: docId,
          solicitante_nome: solicitante,
          solicitante_email: document.getElementById('emp-email').value.trim() || null,
          data_emprestimo: dtEmp,
          data_devolucao_prevista: dtPrev,
          status: 'ativo',
          observacoes: document.getElementById('emp-obs').value.trim() || null,
          doc_protocolo: doc ? doc.protocolo : null,
        });

        await SGA_API.update('documentos', docId, { status: 'emprestado' });

        U.toast('Empréstimo registrado com sucesso!', 'success');
        form.reset();
        document.getElementById('emp-data-emprestimo').value = U.hoje();
        document.getElementById('emp-data-prevista').value = prev.toISOString().slice(0, 10);
        loadEmprestimoData();
      } catch (err) {
        U.toast(`Erro: ${err.message}`, 'error');
      } finally {
        U.loading(btn, false);
      }
    });
  }

  async function loadEmprestimoData() {
    try {
      const [docs, emps] = await Promise.all([
        SGA_API.list('documentos', '&status=eq.disponivel&order=protocolo', 'id,protocolo,descricao'),
        SGA_API.list('emprestimos', '&status=eq.ativo&order=data_devolucao_prevista',
          'id,documento_id,doc_protocolo,solicitante_nome,data_emprestimo,data_devolucao_prevista,status'),
      ]);

      docsDisponiveis = docs || [];
      emprestimosAtivos = emps || [];

      // Select de documentos disponíveis
      const sel = document.getElementById('emp-doc');
      sel.innerHTML = '<option value="">Selecione o documento…</option>' +
        docsDisponiveis.map(d =>
          `<option value="${U.esc(d.id)}">${U.esc(d.protocolo)} — ${U.esc(d.descricao.slice(0, 60))}</option>`
        ).join('');

      // Tabela de ativos
      document.getElementById('emprestimos-ativos-count').textContent = emprestimosAtivos.length;
      const tbody = document.querySelector('#table-emprestimos tbody');
      const hoje = U.hoje();

      tbody.innerHTML = emprestimosAtivos.length
        ? emprestimosAtivos.map(e => {
            const atrasado = e.data_devolucao_prevista && e.data_devolucao_prevista < hoje;
            return `
            <tr>
              <td class="cell-protocolo">${U.esc(e.doc_protocolo || '—')}</td>
              <td>${U.esc(e.solicitante_nome)}</td>
              <td>${U.fmtData(e.data_emprestimo)}</td>
              <td>${U.fmtData(e.data_devolucao_prevista)}</td>
              <td>${U.pill(atrasado ? 'atrasado' : 'ativo')}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-sm btn-success" data-return="${U.esc(e.id)}" data-doc="${U.esc(e.documento_id)}">Devolver</button>
                </div>
              </td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="6" class="empty-state">Nenhum empréstimo ativo</td></tr>';

      tbody.querySelectorAll('[data-return]').forEach(btn => {
        btn.addEventListener('click', () => devolver(btn.dataset.return, btn.dataset.doc));
      });

    } catch (err) {
      U.toast(`Erro ao carregar empréstimos: ${err.message}`, 'error');
    }
  }

  async function devolver(empId, docId) {
    if (!confirm('Confirmar devolução deste documento?')) return;
    try {
      await SGA_API.update('emprestimos', empId, {
        status: 'devolvido',
        data_devolucao_real: U.hoje(),
      });
      await SGA_API.update('documentos', docId, { status: 'disponivel' });
      U.toast('Devolução registrada!', 'success');
      loadEmprestimoData();
    } catch (err) {
      U.toast(`Erro: ${err.message}`, 'error');
    }
  }

  /* ============================================================
     SEÇÃO: RELATÓRIOS
     ============================================================ */
  let relatorioInit = false;

  function initRelatorioOnce() {
    if (relatorioInit) return;
    relatorioInit = true;

    const form = document.getElementById('form-relatorio');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const tipo = document.getElementById('rel-tipo').value;
      const setor = document.getElementById('rel-setor').value;

      try {
        await gerarRelatorio(tipo, setor);
      } catch (err) {
        U.toast(`Erro no relatório: ${err.message}`, 'error');
      }
    });

    document.getElementById('btn-imprimir').addEventListener('click', () => window.print());
  }

  async function gerarRelatorio(tipo, setorFiltro) {
    const wrap = document.getElementById('relatorio-conteudo');
    const panel = document.getElementById('relatorio-resultado');
    const btnPrint = document.getElementById('btn-imprimir');

    wrap.innerHTML = '<p class="empty-state">Gerando…</p>';
    panel.hidden = false;
    btnPrint.disabled = true;

    const [docs, emps] = await Promise.all([
      SGA_API.list('documentos', '&order=protocolo',
        'protocolo,descricao,tipo,setor,status,prazo_guarda,caixas(codigo,sala:salas(codigo),estante:estantes(codigo),prateleira:prateleiras(codigo))'),
      SGA_API.list('emprestimos', '&order=data_emprestimo.desc',
        'doc_protocolo,solicitante_nome,data_emprestimo,data_devolucao_prevista,data_devolucao_real,status'),
    ]);

    let documentos = docs || [];
    if (setorFiltro) documentos = documentos.filter(d => d.setor === setorFiltro);
    const emprestimos = emps || [];
    const hoje = U.hoje();

    let titulo = '';
    let html = '';

    const th = cols => `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    // Aceita string (célula simples) ou { cls, html } (com classe na <td>)
    const tdRow = cols => `<tr>${cols.map(c =>
      c && typeof c === 'object'
        ? `<td class="${c.cls}">${c.html}</td>`
        : `<td>${c}</td>`
    ).join('')}</tr>`;

    switch (tipo) {
      case 'acervo': {
        titulo = 'Acervo Completo';
        html = `<table class="data-table">${th(['Protocolo', 'Descrição', 'Tipo', 'Setor', 'Status', 'Localização'])}<tbody>` +
          (documentos.length
            ? documentos.map(d => tdRow([
                { cls: 'cell-protocolo', html: `<strong>${U.esc(d.protocolo)}</strong>` },
                U.esc(d.descricao), U.esc(d.tipo), U.esc(d.setor),
                U.pill(d.status),
                { cls: 'cell-local', html: U.esc(U.locLabel(d.caixas)) },
              ])).join('')
            : '<tr><td colspan="6" class="empty-state">Sem dados</td></tr>') +
          '</tbody></table>';
        break;
      }
      case 'setor': {
        titulo = 'Documentos por Setor';
        const mapa = {};
        documentos.forEach(d => { (mapa[d.setor] = mapa[d.setor] || []).push(d); });
        html = `<table class="data-table">${th(['Setor', 'Total', 'Disponíveis', 'Emprestados'])}<tbody>` +
          (Object.keys(mapa).length
            ? Object.entries(mapa).map(([s, arr]) => tdRow([
                `<strong>${U.esc(s)}</strong>`,
                arr.length,
                arr.filter(d => d.status === 'disponivel').length,
                arr.filter(d => d.status === 'emprestado').length,
              ])).join('')
            : '<tr><td colspan="4" class="empty-state">Sem dados</td></tr>') +
          '</tbody></table>';
        break;
      }
      case 'status': {
        titulo = 'Documentos por Status';
        const cont = { disponivel: 0, emprestado: 0, descartavel: 0, descartado: 0 };
        documentos.forEach(d => { if (cont[d.status] !== undefined) cont[d.status]++; });
        html = `<table class="data-table">${th(['Status', 'Total'])}<tbody>` +
          Object.entries(cont).map(([s, n]) => tdRow([U.pill(s), n])).join('') +
          '</tbody></table>';
        break;
      }
      case 'temporalidade': {
        titulo = 'Temporalidade / Prazos de Guarda';
        const comPrazo = documentos
          .filter(d => d.prazo_guarda && d.status !== 'descartado')
          .sort((a, b) => a.prazo_guarda.localeCompare(b.prazo_guarda));
        html = `<table class="data-table">${th(['Protocolo', 'Descrição', 'Setor', 'Prazo de Guarda', 'Situação'])}<tbody>` +
          (comPrazo.length
            ? comPrazo.map(d => {
                const vencido = d.prazo_guarda <= hoje;
                return tdRow([
                  { cls: 'cell-protocolo', html: `<strong>${U.esc(d.protocolo)}</strong>` },
                  U.esc(d.descricao), U.esc(d.setor),
                  U.fmtData(d.prazo_guarda),
                  vencido ? '<span class="status status-atrasado">Vencido</span>' : '<span class="status status-ativo">Vigente</span>',
                ]);
              }).join('')
            : '<tr><td colspan="5" class="empty-state">Sem documentos com prazo definido</td></tr>') +
          '</tbody></table>';
        break;
      }
      case 'emprestimos': {
        titulo = 'Histórico de Empréstimos';
        html = `<table class="data-table">${th(['Documento', 'Solicitante', 'Saída', 'Prevista', 'Devolução', 'Status'])}<tbody>` +
          (emprestimos.length
            ? emprestimos.map(e => tdRow([
                { cls: 'cell-protocolo', html: U.esc(e.doc_protocolo || '—') },
                U.esc(e.solicitante_nome),
                U.fmtData(e.data_emprestimo),
                U.fmtData(e.data_devolucao_prevista),
                U.fmtData(e.data_devolucao_real),
                U.pill(e.status),
              ])).join('')
            : '<tr><td colspan="6" class="empty-state">Sem empréstimos</td></tr>') +
          '</tbody></table>';
        break;
      }
      case 'descarte': {
        titulo = 'Documentos para Descarte';
        const lista = documentos.filter(
          d => d.prazo_guarda && d.prazo_guarda <= hoje && d.status !== 'descartado'
        );
        html = `<table class="data-table">${th(['Protocolo', 'Descrição', 'Setor', 'Prazo vencido em'])}<tbody>` +
          (lista.length
            ? lista.map(d => tdRow([
                { cls: 'cell-protocolo', html: `<strong>${U.esc(d.protocolo)}</strong>` },
                U.esc(d.descricao), U.esc(d.setor),
                U.fmtData(d.prazo_guarda),
              ])).join('')
            : '<tr><td colspan="4" class="empty-state">Nenhum documento vencido para descarte</td></tr>') +
          '</tbody></table>';
        break;
      }
    }

    document.getElementById('relatorio-titulo').textContent = titulo;
    document.getElementById('relatorio-meta').textContent =
      `Gerado em ${new Date().toLocaleString('pt-BR')}${setorFiltro ? ` — Setor: ${setorFiltro}` : ''}`;
    wrap.innerHTML = html;
    btnPrint.disabled = false;
  }

  /* ============================================================
     SEÇÃO: TEMPORALIDADE — somente documentos VENCIDOS e os que
     vencem em até 15 dias
     ============================================================ */
  const JANELA_VENCIMENTO_DIAS = 15;

  async function loadTemporalidade() {
    const tbody = document.querySelector('#table-temporalidade tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Carregando…</td></tr>';

    try {
      const docs = await SGA_API.list(
        'documentos',
        '&order=prazo_guarda.asc&limit=2000',
        'id,protocolo,descricao,setor,prazo_guarda,status'
      );

      const hoje = U.hoje();
      const limite = new Date(Date.now() + JANELA_VENCIMENTO_DIAS * 86400000)
        .toISOString().slice(0, 10);

      // Vencidos (prazo <= hoje) + os que vencem em até 15 dias
      const lista = (docs || [])
        .filter(d => d.prazo_guarda && d.status !== 'descartado' && d.prazo_guarda <= limite)
        .sort((a, b) => a.prazo_guarda.localeCompare(b.prazo_guarda));

      document.getElementById('temp-count').textContent = lista.length;

      if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum documento vencido ou a vencer em até 15 dias</td></tr>';
        return;
      }

      tbody.innerHTML = lista.map(d => {
        const dias = Math.round(
          (Date.parse(d.prazo_guarda) - Date.parse(hoje)) / 86400000
        );
        let situacao;
        if (dias < 0) {
          situacao = '<span class="status status-atrasado">Vencido</span>';
        } else if (dias === 0) {
          situacao = '<span class="status status-emprestado">Vence hoje</span>';
        } else {
          situacao = `<span class="status status-emprestado">Vence em ${dias} dia${dias > 1 ? 's' : ''}</span>`;
        }
        return `
        <tr>
          <td class="cell-protocolo"><strong>${U.esc(d.protocolo)}</strong></td>
          <td><span class="cell-desc" title="${U.esc(d.descricao)}">${U.esc(d.descricao)}</span></td>
          <td>${U.esc(d.setor)}</td>
          <td class="cell-protocolo">${U.fmtData(d.prazo_guarda)}</td>
          <td>${situacao}</td>
        </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Erro: ${U.esc(err.message)}</td></tr>`;
      U.toast(err.message, 'error');
    }
  }

  /* ============================================================
     SEÇÃO: USUÁRIOS (somente admin)
     ============================================================ */
  let usuariosInit = false;
  let usuariosCache = [];

  function initUsuariosOnce() {
    if (usuariosInit) return;
    usuariosInit = true;
    document.getElementById('btn-novo-usuario').addEventListener('click', showNovoUsuario);
  }

  async function loadUsuarios() {
    const tbody = document.querySelector('#table-usuarios tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Carregando…</td></tr>';
    try {
      usuariosCache = (await SGA_API.listarUsuarios()) || [];
      renderUsuarios();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Erro: ${U.esc(err.message)}</td></tr>`;
      U.toast(err.message, 'error');
    }
  }

  function renderUsuarios() {
    const tbody = document.querySelector('#table-usuarios tbody');
    const meuId = (SGA_API.getStoredUser() || {}).id;

    if (!usuariosCache.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum usuário cadastrado</td></tr>';
      return;
    }

    tbody.innerHTML = usuariosCache.map(u => `
      <tr>
        <td><strong>${U.esc(u.nome || '—')}</strong></td>
        <td>${U.esc(u.email || '—')}</td>
        <td>${U.esc(u.perfil || '—')}</td>
        <td>${u.created_at ? U.fmtData(String(u.created_at).slice(0, 10)) : '—'}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-ghost" data-perfil="${U.esc(u.id)}">Perfil</button>
            <button class="btn btn-sm btn-ghost" data-senha="${U.esc(u.id)}">Senha</button>
            <button class="btn btn-sm btn-danger" data-excluir="${U.esc(u.id)}"${u.id === meuId ? ' disabled' : ''}>Excluir</button>
          </div>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-perfil]').forEach(b =>
      b.addEventListener('click', () => showAlterarPerfil(b.dataset.perfil)));
    tbody.querySelectorAll('[data-senha]').forEach(b =>
      b.addEventListener('click', () => showAlterarSenha(b.dataset.senha)));
    tbody.querySelectorAll('[data-excluir]').forEach(b =>
      b.addEventListener('click', () => excluirUsuario(b.dataset.excluir)));
  }

  function showNovoUsuario() {
    Modal.open('Novo Usuário', `
      <form id="form-novo-usuario" class="form-stack" novalidate>
        <div class="form-group">
          <label for="nu-nome">Nome *</label>
          <input type="text" id="nu-nome" maxlength="120" placeholder="Nome completo" autocomplete="off">
          <span class="field-error" id="error-nu-nome" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="nu-email">E-mail *</label>
          <input type="email" id="nu-email" maxlength="120" placeholder="usuario@empresa.com" autocomplete="off">
          <span class="field-error" id="error-nu-email" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="nu-senha">Senha *</label>
          <input type="password" id="nu-senha" maxlength="72" placeholder="Mínimo de 6 caracteres" autocomplete="new-password">
          <span class="field-error" id="error-nu-senha" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="nu-perfil">Perfil *</label>
          <select id="nu-perfil">
            <option value="arquivista">Arquivista</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="btn-criar-usuario">Criar usuário</button>
          <button type="button" class="btn btn-ghost" id="btn-cancelar-usuario">Cancelar</button>
        </div>
      </form>`);

    const form = document.getElementById('form-novo-usuario');
    document.getElementById('btn-cancelar-usuario').addEventListener('click', () => Modal.close());

    form.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(form);

      const nome = document.getElementById('nu-nome').value.trim();
      const email = document.getElementById('nu-email').value.trim();
      const senha = document.getElementById('nu-senha').value;
      const perfil = document.getElementById('nu-perfil').value;

      let ok = true;
      if (!nome) { U.setError('nu-nome', 'Informe o nome.'); ok = false; }
      if (!email) { U.setError('nu-email', 'Informe o e-mail.'); ok = false; }
      else if (!U.isEmail(email)) { U.setError('nu-email', 'E-mail inválido.'); ok = false; }
      if (!senha) { U.setError('nu-senha', 'Informe a senha.'); ok = false; }
      else if (senha.length < 6) { U.setError('nu-senha', 'Mínimo de 6 caracteres.'); ok = false; }
      if (!ok) return;

      const btn = document.getElementById('btn-criar-usuario');
      U.loading(btn, true);
      try {
        await SGA_API.criarUsuario({ email, nome, senha, perfil });
        U.toast(`Usuário ${email} criado!`, 'success');
        Modal.close();
        loadUsuarios();
      } catch (err) {
        U.toast(err.message, 'error');
        U.loading(btn, false);
      }
    });
  }

  function showAlterarPerfil(id) {
    const u = usuariosCache.find(x => x.id === id);
    if (!u) return;
    if (u.id === (SGA_API.getStoredUser() || {}).id) {
      U.toast('Você não pode alterar o próprio perfil.', 'warning');
      return;
    }

    Modal.open('Alterar perfil', `
      <form id="form-perfil-usuario" class="form-stack" novalidate>
        <div class="form-group">
          <label for="pu-email">Usuário</label>
          <input type="text" id="pu-email" value="${U.esc(u.email || '')}" disabled>
        </div>
        <div class="form-group">
          <label for="pu-perfil">Perfil</label>
          <select id="pu-perfil">
            <option value="arquivista"${u.perfil === 'arquivista' ? ' selected' : ''}>Arquivista</option>
            <option value="admin"${u.perfil === 'admin' ? ' selected' : ''}>Administrador</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="btn-salvar-perfil">Salvar</button>
          <button type="button" class="btn btn-ghost" id="btn-cancelar-perfil">Cancelar</button>
        </div>
      </form>`);

    const form = document.getElementById('form-perfil-usuario');
    document.getElementById('btn-cancelar-perfil').addEventListener('click', () => Modal.close());

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('btn-salvar-perfil');
      U.loading(btn, true);
      try {
        await SGA_API.alterarPerfil(u.id, document.getElementById('pu-perfil').value);
        U.toast('Perfil atualizado!', 'success');
        Modal.close();
        loadUsuarios();
      } catch (err) {
        U.toast(err.message, 'error');
        U.loading(btn, false);
      }
    });
  }

  function showAlterarSenha(id) {
    const u = usuariosCache.find(x => x.id === id);
    if (!u) return;

    Modal.open('Redefinir senha', `
      <form id="form-senha-usuario" class="form-stack" novalidate>
        <div class="form-group">
          <label for="ps-email">Usuário</label>
          <input type="text" id="ps-email" value="${U.esc(u.email || '')}" disabled>
        </div>
        <div class="form-group">
          <label for="ps-senha">Nova senha *</label>
          <input type="password" id="ps-senha" maxlength="72" placeholder="Mínimo de 6 caracteres" autocomplete="new-password">
          <span class="field-error" id="error-ps-senha" role="alert"></span>
        </div>
        <div class="form-group">
          <label for="ps-confirma">Confirmar senha *</label>
          <input type="password" id="ps-confirma" maxlength="72" placeholder="Repita a nova senha" autocomplete="new-password">
          <span class="field-error" id="error-ps-confirma" role="alert"></span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" id="btn-salvar-senha">Salvar senha</button>
          <button type="button" class="btn btn-ghost" id="btn-cancelar-senha">Cancelar</button>
        </div>
      </form>`);

    const form = document.getElementById('form-senha-usuario');
    document.getElementById('btn-cancelar-senha').addEventListener('click', () => Modal.close());

    form.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(form);

      const senha = document.getElementById('ps-senha').value;
      const confirma = document.getElementById('ps-confirma').value;

      let ok = true;
      if (!senha) { U.setError('ps-senha', 'Informe a nova senha.'); ok = false; }
      else if (senha.length < 6) { U.setError('ps-senha', 'Mínimo de 6 caracteres.'); ok = false; }
      if (senha !== confirma) { U.setError('ps-confirma', 'As senhas não conferem.'); ok = false; }
      if (!ok) return;

      const btn = document.getElementById('btn-salvar-senha');
      U.loading(btn, true);
      try {
        await SGA_API.alterarSenha(u.id, senha);
        U.toast('Senha redefinida! As sessões antigas foram encerradas.', 'success');
        Modal.close();
      } catch (err) {
        U.toast(err.message, 'error');
        U.loading(btn, false);
      }
    });
  }

  async function excluirUsuario(id) {
    const u = usuariosCache.find(x => x.id === id);
    if (!u) return;
    if (!confirm(`Excluir definitivamente ${u.email}? O acesso ao sistema será removido.`)) return;
    try {
      await SGA_API.excluirUsuario(id);
      U.toast('Usuário excluído.', 'success');
      loadUsuarios();
    } catch (err) {
      U.toast(err.message, 'error');
    }
  }

  /* ============================================================
     SEÇÃO: AUDITORIA (somente admin)
     ============================================================ */
  let auditoriaInit = false;
  let auditoriaItens = [];
  let auditoriaOffset = 0;
  const AUD_LIMITE = 50;

  function initAuditoriaOnce() {
    if (auditoriaInit) return;
    auditoriaInit = true;

    document.getElementById('form-auditoria').addEventListener('submit', e => {
      e.preventDefault();
      loadAuditoria(true);
    });

    document.getElementById('btn-aud-limpar').addEventListener('click', () => {
      document.getElementById('form-auditoria').reset();
      loadAuditoria(true);
    });

    document.getElementById('btn-aud-mais').addEventListener('click', () => loadAuditoria(false));
  }

  async function fillAuditoriaUsuarios() {
    try {
      const users = (await SGA_API.listarUsuarios()) || [];
      const sel = document.getElementById('aud-usuario');
      const atual = sel.value;
      sel.innerHTML = '<option value="">Todos</option>' +
        users.map(u => `<option value="${U.esc(u.id)}">${U.esc(u.email || u.nome || u.id)}</option>`).join('');
      if (atual) sel.value = atual;
    } catch { /* filtro continua funcional com "Todos" */ }
  }

  async function loadAuditoria(reset = true) {
    const tbody = document.querySelector('#table-auditoria tbody');

    if (reset) {
      auditoriaOffset = 0;
      auditoriaItens = [];
      document.getElementById('btn-aud-mais').hidden = true;
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Carregando…</td></tr>';
      await fillAuditoriaUsuarios();
    }

    try {
      const r = await SGA_API.listarAuditoria({
        usuarioId: document.getElementById('aud-usuario').value,
        tabela: document.getElementById('aud-tabela').value,
        acao: document.getElementById('aud-acao').value,
        limite: AUD_LIMITE,
        offset: auditoriaOffset,
      });

      auditoriaItens = auditoriaItens.concat(r.itens);
      auditoriaOffset = auditoriaItens.length;
      renderAuditoria();
      document.getElementById('btn-aud-mais').hidden = !r.temMais;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Erro: ${U.esc(err.message)}</td></tr>`;
      U.toast(err.message, 'error');
    }
  }

  function acaoPill(acao) {
    const mapa = {
      INSERT: 'status-disponivel',
      UPDATE: 'status-descartavel',
      DELETE: 'status-atrasado',
      LOGIN: 'status-ativo',
      LOGOUT: 'status-devolvido',
    };
    return `<span class="status ${mapa[acao] || 'status-descartado'}">${U.esc(acao)}</span>`;
  }

  function renderAuditoria() {
    const tbody = document.querySelector('#table-auditoria tbody');
    document.getElementById('aud-count').textContent = auditoriaItens.length;

    if (!auditoriaItens.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum registro encontrado</td></tr>';
      return;
    }

    tbody.innerHTML = auditoriaItens.map(a => `
      <tr>
        <td>${a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR') : '—'}</td>
        <td>${U.esc(a.usuario_email || '—')}</td>
        <td>${U.esc(a.usuario_perfil || '—')}</td>
        <td>${U.esc(a.tabela)}</td>
        <td>${acaoPill(a.acao)}</td>
        <td>${U.esc(String(a.registro_id || '—').slice(0, 8))}</td>
        <td><button class="btn btn-sm btn-ghost" data-aud="${U.esc(a.id)}">Detalhes</button></td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-aud]').forEach(b => {
      b.addEventListener('click', () => {
        const item = auditoriaItens.find(x => String(x.id) === b.dataset.aud);
        if (item) showAuditoriaDetalhe(item);
      });
    });
  }

  function showAuditoriaDetalhe(a) {
    const json = v => v
      ? `<pre class="aud-json">${U.esc(JSON.stringify(v, null, 2))}</pre>`
      : '—';

    const rows = [
      ['Data / Hora', a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR') : '—'],
      ['Usuário', U.esc(a.usuario_email || '—')],
      ['Perfil', U.esc(a.usuario_perfil || '—')],
      ['Tabela', U.esc(a.tabela)],
      ['Ação', U.esc(a.acao)],
      ['Registro', U.esc(a.registro_id || '—')],
      ['Antes', json(a.dados_antes)],
      ['Depois', json(a.dados_depois)],
    ];

    const html = rows.map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    Modal.open(`Auditoria #${a.id}`, `<dl>${html}</dl>`);
  }

  /* ============================================================
     INICIALIZAÇÃO
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    // Cache dessincronizado: api.js antigo ignora os filtros novos
    // (protocolo/descricao) e a pesquisa "volta todos os documentos".
    if (SGA_API.versao !== VERSAO_APP) {
      console.warn(
        `SGA: arquivos fora de versão — api.js=${SGA_API.versao || 'antigo'} ` +
        `vs app.js=${VERSAO_APP}. Recarregue com Ctrl+F5.`
      );
      if (document.getElementById('toast-container')) {
        setTimeout(() => U.toast(
          'Sistema desatualizado no cache. Pressione Ctrl+F5 para atualizar.',
          'error', 10000
        ), 600);
      }
    }

    initLogin();
    initApp();
  });
})();
