/**
 * SGA - Aplicação principal
 * Contém: utilitários, tela de login e todo o painel (menu lateral,
 * painel de métricas, pesquisa, cadastro, empréstimo/devolução e relatórios).
 *
 * Observação sobre o "Where's Waldo": nada de frameworks — JS puro ES6+.
 */
(() => {
  'use strict';

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

    // Se já há sessão válida, vai direto ao painel
    if (SGA_API.getSession()) {
      window.location.replace('dashboard.html');
      return;
    }

    const emailEl = document.getElementById('login-email');
    const passEl = document.getElementById('login-password');
    const alertEl = document.getElementById('login-alert');
    const btn = document.getElementById('btn-login');
    const remember = document.getElementById('login-remember');

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
  function initApp() {
    const content = document.getElementById('content');
    if (!content) return; // não é a página do painel

    // ---- Guarda de sessão ----
    const session = SGA_API.getSession();
    const user = SGA_API.getStoredUser();
    if (!session || !user) {
      window.location.replace('index.html');
      return;
    }

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
    setupMenu();
    setupTabs();

    // Carrega a seção inicial
    loadSection('painel');

    // Sair
    document.getElementById('btn-logout').addEventListener('click', async () => {
      if (!confirm('Deseja realmente sair do sistema?')) return;
      await SGA_API.logout();
      window.location.href = 'index.html';
    });
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
  const SECTION_TITLES = {
    painel: 'Painel',
    pesquisa: 'Pesquisa',
    cadastro: 'Cadastro',
    emprestimo: 'Empréstimo / Devolução',
    relatorio: 'Relatórios',
  };

  let currentSection = 'painel';

  function setupMenu() {
    document.querySelectorAll('.nav-item[data-section]').forEach(btn => {
      btn.addEventListener('click', () => loadSection(btn.dataset.section));
    });
  }

  function loadSection(name) {
    currentSection = name;

    // Menu ativo
    document.querySelectorAll('.nav-item[data-section]').forEach(b => {
      b.classList.toggle('active', b.dataset.section === name);
    });

    // Seções visíveis
    document.querySelectorAll('.section').forEach(s => {
      s.classList.toggle('active', s.id === `section-${name}`);
    });

    document.getElementById('section-title').textContent = SECTION_TITLES[name] || name;

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
      case 'relatorio':
        initRelatorioOnce();
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
        .slice(0, 8);

      const tbodyDoc = document.querySelector('#table-recentes tbody');
      tbodyDoc.innerHTML = recentes.length
        ? recentes.map(d => `
            <tr>
              <td><strong>${U.esc(d.protocolo)}</strong></td>
              <td>${U.esc(d.descricao)}</td>
              <td>${U.esc(d.setor)}</td>
              <td>${U.pill(d.status)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="empty-state">Nenhum documento cadastrado ainda</td></tr>';

      // Empréstimos ativos
      const ativos = m.emprestimos
        .filter(e => e.status === 'ativo')
        .sort((a, b) => (a.data_devolucao_prevista || '').localeCompare(b.data_devolucao_prevista || ''))
        .slice(0, 8);

      const tbodyEmp = document.querySelector('#table-emprestimos-ativos tbody');
      tbodyEmp.innerHTML = ativos.length
        ? ativos.map(e => {
            const atrasado = e.data_devolucao_prevista && e.data_devolucao_prevista < U.hoje();
            return `
            <tr>
              <td>${U.esc(e.doc_protocolo || e.documento_id || '—')}</td>
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
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const tbody = document.querySelector('#table-pesquisa tbody');
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Pesquisando…</td></tr>';

      try {
        const filtros = {
          texto: document.getElementById('pesq-texto').value.trim(),
          setor: document.getElementById('pesq-setor').value,
          status: document.getElementById('pesq-status').value,
          tipo: document.getElementById('pesq-tipo').value.trim(),
        };
        const docs = await SGA_API.searchDocumentos(filtros);
        renderPesquisa(docs || []);
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Erro: ${U.esc(err.message)}</td></tr>`;
        U.toast(err.message, 'error');
      }
    });

    document.getElementById('btn-limpar-pesquisa').addEventListener('click', () => {
      form.reset();
      renderPesquisa([]);
      document.getElementById('pesquisa-count').textContent = '0';
    });
  }

  function renderPesquisa(docs) {
    document.getElementById('pesquisa-count').textContent = docs.length;
    const tbody = document.querySelector('#table-pesquisa tbody');

    if (!docs.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum documento encontrado</td></tr>';
      return;
    }

    tbody.innerHTML = docs.map(d => `
      <tr>
        <td><strong>${U.esc(d.protocolo)}</strong></td>
        <td>${U.esc(d.codigo || '—')}</td>
        <td>${U.esc(d.descricao)}</td>
        <td>${U.esc(d.tipo)}</td>
        <td>${U.esc(d.setor)}</td>
        <td>${U.pill(d.status)}</td>
        <td>${U.esc(U.locLabel(d.caixas))}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-ghost" data-view="${U.esc(d.id)}">Detalhes</button>
          </div>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const doc = docs.find(x => x.id === btn.dataset.view);
        if (doc) showDocDetails(doc);
      });
    });
  }

  function showDocDetails(d) {
    const rows = [
      ['Protocolo', `<strong>${U.esc(d.protocolo)}</strong>`],
      ['Código', U.esc(d.codigo || '—')],
      ['Descrição', U.esc(d.descricao)],
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
    Modal.open(`Documento ${d.protocolo}`, `<dl>${html}</dl>`);
  }

  /* ============================================================
     SEÇÃO: CADASTRO
     ============================================================ */
  let cadastroInit = false;
  let currentProtocolo = null;

  function initCadastroOnce() {
    if (cadastroInit) return;
    cadastroInit = true;

    // Próximo protocolo
    refreshProtocolo();

    // ---------- Documento ----------
    const formDoc = document.getElementById('form-documento');
    formDoc.addEventListener('submit', async e => {
      e.preventDefault();
      U.clearErrors(formDoc);

      let ok = true;
      const descricao = document.getElementById('doc-descricao').value.trim();
      const tipo = document.getElementById('doc-tipo').value.trim();
      const setor = document.getElementById('doc-setor').value;

      if (!descricao) { U.setError('doc-descricao', 'A descrição é obrigatória.'); ok = false; }
      if (!tipo) { U.setError('doc-tipo', 'Informe o tipo.'); ok = false; }
      if (!setor) { U.setError('doc-setor', 'Selecione o setor.'); ok = false; }
      if (!ok) return;

      const btn = document.getElementById('btn-salvar-doc');
      U.loading(btn, true);

      try {
        if (!currentProtocolo) currentProtocolo = await SGA_API.gerarProtocolo();

        await SGA_API.insert('documentos', {
          protocolo: currentProtocolo,
          codigo: document.getElementById('doc-codigo').value.trim() || null,
          descricao,
          tipo,
          setor,
          categoria: document.getElementById('doc-categoria').value || null,
          data_documento: document.getElementById('doc-data').value || null,
          prazo_guarda: document.getElementById('doc-prazo').value || null,
          caixa_id: document.getElementById('doc-caixa').value || null,
          observacoes: document.getElementById('doc-observacoes').value.trim() || null,
          status: 'disponivel',
        });

        U.toast(`Documento ${currentProtocolo} cadastrado com sucesso!`, 'success');
        formDoc.reset();
        currentProtocolo = null;
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
    });

    document.getElementById('form-estante').addEventListener('submit', async e => {
      e.preventDefault();
      const salaId = document.getElementById('estante-sala').value;
      const codigo = document.getElementById('estante-codigo').value.trim();
      if (!salaId || !codigo) { U.toast('Preencha sala e código.', 'warning'); return; }
      try {
        await SGA_API.insert('estantes', {
          codigo, sala_id: salaId,
          descricao: document.getElementById('estante-descricao').value.trim() || null,
        });
        U.toast('Estante cadastrada!', 'success');
        e.target.reset();
        loadLocalSelects();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    document.getElementById('form-prateleira').addEventListener('submit', async e => {
      e.preventDefault();
      const estanteId = document.getElementById('prat-estante').value;
      const codigo = document.getElementById('prat-codigo').value.trim();
      if (!estanteId || !codigo) { U.toast('Preencha estante e código.', 'warning'); return; }
      try {
        await SGA_API.insert('prateleiras', {
          codigo, estante_id: estanteId,
          descricao: document.getElementById('prat-descricao').value.trim() || null,
        });
        U.toast('Prateleira cadastrada!', 'success');
        e.target.reset();
        loadLocalSelects();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    document.getElementById('form-caixa').addEventListener('submit', async e => {
      e.preventDefault();
      const codigo = document.getElementById('caixa-codigo').value.trim();
      const salaId = document.getElementById('caixa-sala').value;
      if (!codigo || !salaId) { U.toast('Preencha código e sala.', 'warning'); return; }
      try {
        await SGA_API.insert('caixas', {
          codigo,
          sala_id: salaId,
          estante_id: document.getElementById('caixa-estante').value || null,
          prateleira_id: document.getElementById('caixa-prateleira').value || null,
          capacidade: parseInt(document.getElementById('caixa-capacidade').value, 10) || 50,
          descricao: null,
        });
        U.toast('Caixa cadastrada!', 'success');
        e.target.reset();
        document.getElementById('caixa-capacidade').value = 50;
        loadLocalSelects();
        loadCaixasTable();
        loadCaixasNoSelect();
      } catch (err) { U.toast(err.message, 'error'); }
    });

    // Carregamentos iniciais
    loadLocalSelects();
    loadCaixasNoSelect();
    loadCaixasTable();
  }

  async function refreshProtocolo() {
    try {
      currentProtocolo = await SGA_API.gerarProtocolo();
      document.getElementById('protocolo-preview').textContent = `Protocolo: ${currentProtocolo}`;
    } catch {
      document.getElementById('protocolo-preview').textContent = 'Protocolo: —';
    }
  }

  function bindSimpleForm(formId, table, onSuccess) {
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
      if (!data.codigo) { U.toast('Informe o código.', 'warning'); return; }
      try {
        await SGA_API.insert(table, data);
        form.reset();
        onSuccess && onSuccess();
      } catch (err) {
        U.toast(err.message, 'error');
      }
    });
  }

  async function loadLocalSelects() {
    try {
      const [salas, estantes, prat] = await Promise.all([
        SGA_API.list('salas', '&order=codigo'),
        SGA_API.list('estantes', '&order=codigo'),
        SGA_API.list('prateleiras', '&order=codigo'),
      ]);

      fillSelect('estante-sala', salas, 'Selecione a sala…');
      fillSelect('caixa-sala', salas, 'Selecione a sala…');
      fillSelect('prat-estante', estantes, 'Selecione a estante…');

      // Estantes filtradas pela sala escolhida na caixa (simples: preenche tudo)
      fillSelect('caixa-estante', estantes, 'Selecione…');
      fillSelect('caixa-prateleira', prat, 'Selecione…');
    } catch (err) {
      // silencioso no carregamento inicial (tabelas podem ainda não existir)
      console.warn('loadLocalSelects:', err.message);
    }
  }

  function fillSelect(id, rows, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${U.esc(placeholder)}</option>` +
      (rows || []).map(r => `<option value="${U.esc(r.id)}">${U.esc(r.codigo)}${r.descricao ? ' — ' + U.esc(r.descricao) : ''}</option>`).join('');
    if (current) sel.value = current;
  }

  async function loadCaixasNoSelect() {
    try {
      const caixas = await SGA_API.list('caixas', '&order=codigo');
      fillSelect('doc-caixa', caixas, 'Selecione a caixa…');
    } catch { /* ignore */ }
  }

  async function loadCaixasTable() {
    try {
      const caixas = await SGA_API.list(
        'caixas',
        '&select=*,sala:salas(codigo),estante:estantes(codigo),prateleira:prateleiras(codigo)&order=codigo'
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
        SGA_API.list('documentos', '&status=eq.disponivel&order=protocolo'),
        SGA_API.list('emprestimos', '&status=eq.ativo&order=data_devolucao_prevista'),
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
              <td>${U.esc(e.doc_protocolo || '—')}</td>
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
      SGA_API.list('documentos', '&order=protocolo'),
      SGA_API.list('emprestimos', '&order=data_emprestimo.desc'),
    ]);

    let documentos = docs || [];
    if (setorFiltro) documentos = documentos.filter(d => d.setor === setorFiltro);
    const emprestimos = emps || [];
    const hoje = U.hoje();

    let titulo = '';
    let html = '';

    const th = cols => `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tdRow = (cols, tr) => `<tr>${cols.map(c => `<td>${c}</td>`).join('')}</tr>`;

    switch (tipo) {
      case 'acervo': {
        titulo = 'Acervo Completo';
        html = `<table class="data-table">${th(['Protocolo', 'Descrição', 'Tipo', 'Setor', 'Status', 'Localização'])}<tbody>` +
          (documentos.length
            ? documentos.map(d => tdRow([
                `<strong>${U.esc(d.protocolo)}</strong>`,
                U.esc(d.descricao), U.esc(d.tipo), U.esc(d.setor),
                U.pill(d.status), U.esc(d.codigo || '—'),
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
                  `<strong>${U.esc(d.protocolo)}</strong>`,
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
                U.esc(e.doc_protocolo || '—'),
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
                `<strong>${U.esc(d.protocolo)}</strong>`,
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
     INICIALIZAÇÃO
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initApp();
  });
})();
