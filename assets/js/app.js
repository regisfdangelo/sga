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
  const VERSAO_APP = '20261002.29';

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

      // Mapa do arquivo (select de sala + grade de caixas)
      initMapaArquivo().catch(err => console.warn('mapa do arquivo:', err.message));

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
     MAPA DO ARQUIVO (painel): select de sala + planta da sala.
     A planta é um GRID ÚNICO de estantes: um QUADRADO por
     estante (rótulo da estante fora do quadrado) e, dentro,
     a grade uniforme das caixas da estante — verde = vazia,
     laranja = parcial, cinza = cheia; descrição da caixa no
     tooltip do mouse.
     ============================================================ */
  let mapaInit = false;
  let mapaSeq = 0;
  let mapaSalas = [];

  /**
   * Preenche o select de salas do Painel. O mapa NÃO abre aqui:
   * nem ao entrar na seção nem ao escolher a sala — só com o
   * botão "Ver mapa" (habilitado quando há sala escolhida).
   */
  async function initMapaArquivo() {
    const sel = document.getElementById('mapa-sala');
    if (!sel) return;
    if (!mapaInit) {
      mapaInit = true;
      sel.addEventListener('change', () => {
        atualizaBotaoMapa();
        // Trocar a sala com o mapa aberto: fecha para não mostrar
        // a planta de uma sala e o nome de outra.
        fechaMapa();
      });
      window.addEventListener('resize', encaixaMapa);
      document.getElementById('mapa-abrir')?.addEventListener('click', abreMapa);
      document.getElementById('mapa-popup-fechar')?.addEventListener('click', fechaMapa);
      const popup = document.getElementById('mapa-popup');
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && popup && !popup.hidden) fechaMapa();
      });
    }
    // Com linha/coluna (sql/17) a planta respeita a grade da sala;
    // se o banco ainda não tem as colunas, volta ao select antigo
    // em vez de deixar o mapa sem salas.
    const salas = await SGA_API.list('salas', '&order=codigo&limit=500',
        'id,codigo,descricao,linha,coluna')
      .catch(() => SGA_API.list('salas', '&order=codigo&limit=500',
        'id,codigo,descricao').catch(() => []));
    mapaSalas = salas || [];
    if (mapaSalas.length) fillSelect('mapa-sala', mapaSalas, 'Selecione a sala…');
    atualizaBotaoMapa();
  }

  /**
   * Grade (linhas x colunas) declarada na SALA — null quando a
   * sala foi cadastrada sem os campos (neste caso o mapa estima
   * a grade sozinho, como sempre).
   */
  function gradeDaSala(salaId) {
    const s = mapaSalas.find(x => String(x.id) === String(salaId));
    if (!s) return null;
    const l = parseInt(s.linha, 10), c = parseInt(s.coluna, 10);
    if (!(l > 0) || !(c > 0)) return null;
    return { linhas: l, colunas: c };
  }

  /** Abre o pop-up em tela cheia e carrega o mapa da sala escolhida. */
  function abreMapa() {
    const sel = document.getElementById('mapa-sala');
    const popup = document.getElementById('mapa-popup');
    if (!sel || !popup || !sel.value) return;
    popup.hidden = false;
    document.body.style.overflow = 'hidden';  // remove a rolagem da página
    renderMapaArquivo();
  }

  /** Fecha o pop-up e devolve a rolagem da página. */
  function fechaMapa() {
    const popup = document.getElementById('mapa-popup');
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    document.body.style.overflow = '';
  }

  /** Botão "Ver mapa" só faz sentido com uma sala escolhida. */
  function atualizaBotaoMapa() {
    const sel = document.getElementById('mapa-sala');
    const btn = document.getElementById('mapa-abrir');
    if (btn) btn.disabled = !sel || !sel.value;
  }

  /** Zera os estilos inline de layout do mapa (medidas/variáveis). */
  function limpaEstilosMapa(grid) {
    grid.style.transform = '';
    grid.style.width = '';
    grid.style.height = '';
    grid.style.gap = '';
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
    grid.style.justifyContent = '';
    grid.style.alignContent = '';
    grid.style.removeProperty('--mapa-est-lado');
    grid.style.removeProperty('--mapa-quad-lado');
  }

  /**
   * Encaixa a planta na área branca do pop-up, sem barra de
   * rolagem. Quando cabe, DISTRIBUI os quadrados das estantes
   * por TODA a tela branca (espaços iguais) e aumenta o
   * tamanho dos quadrados e das caixas até o limite da área;
   * quando não dá nem o tamanho mínimo, volta ao tamanho
   * natural e reduz (scale) o conjunto inteiro.
   */
  function encaixaMapa() {
    const popup = document.getElementById('mapa-popup');
    const frame = popup && popup.querySelector('.mapa-frame');
    const grid = document.getElementById('mapa-estantes');
    if (!popup || popup.hidden || !frame || !grid) return;
    grid.style.transform = 'none';
    if (!grid.querySelector('.mapa-est')) {
      grid.classList.remove('planta');
      limpaEstilosMapa(grid);
      return;
    }
    grid.classList.add('planta');

    const folga = 24;
    const dispW = Math.max(0, frame.clientWidth - folga);
    const dispH = Math.max(0, frame.clientHeight - folga);
    const n = Number(grid.dataset.blocos) || 1;
    const dimMax = Math.max(1, Number(grid.dataset.dimmax) || 1);
    const gapX = 22, gapY = 26;
    const sobre = 28;        // altura do rótulo da estante + espaço até o quadrado
    const LADO_MIN = 110;    // abaixo disso o aumento atrapalha: fica o scale

    const ladoDe = (c, m) => Math.floor(Math.min(
      (dispW - gapX * (c - 1)) / c,
      (dispH - gapY * (m - 1) - sobre * m) / m
    ));

    /**
     * Escolhe colunas × linhas. Com grade gravada na sala
     * (data-linhas/data-colunas) usa exatamente essa grade — cada
     * estante fica na casa que o banco guardou; se o quadrado
     * fica pequeno demais, cai no modo escala abaixo. Sem grade,
     * a planta estima a melhor combinação: a que COMPLETA a
     * última linha (sem "buraco") e, entre as iguais, a que dá
     * quadrados maiores — sempre que couber no tamanho mínimo.
     */
    const gradeLin = Number(grid.dataset.linhas) || 0;
    const gradeCol = Number(grid.dataset.colunas) || 0;
    let melhor = null;
    if (gradeLin > 0 && gradeCol > 0) {
      const lado = ladoDe(gradeCol, gradeLin);
      if (lado >= LADO_MIN) melhor = { c: gradeCol, m: gradeLin, lado };
    } else {
      for (let c = 1; c <= n; c++) {
        const m = Math.ceil(n / c);
        const lado = ladoDe(c, m);
        if (lado < LADO_MIN) continue;
        const resto = n % c;
        const vazio = resto === 0 ? 0 : c - resto;
        if (!melhor || vazio < melhor.vazio ||
            (vazio === melhor.vazio && lado > melhor.lado)) {
          melhor = { c, m, lado, vazio };
        }
      }
    }

    if (melhor) {
      // Modo "preenche a tela": quadrados distribuídos por toda a
      // área branca e maiores (caixas até 52px, contra 26px antes)
      const { c: k, m, lado } = melhor;
      const pad = 9, gapQuad = 5;
      const quad = Math.max(12, Math.min(52,
        Math.floor((lado - pad * 2 - gapQuad * (dimMax - 1)) / dimMax)));
      grid.style.width = dispW + 'px';
      grid.style.height = dispH + 'px';
      grid.style.gap = `${gapY}px ${gapX}px`;
      grid.style.gridTemplateColumns = `repeat(${k}, ${lado}px)`;
      grid.style.gridTemplateRows = '';
      grid.style.justifyContent = 'space-evenly';
      grid.style.alignContent = 'space-evenly';
      grid.style.setProperty('--mapa-est-lado', lado + 'px');
      grid.style.setProperty('--mapa-quad-lado', quad + 'px');
      return;
    }

    // Modo natural + scale: muita estante/caixa para a área
    // (com grade gravada, as colunas continuam sendo as da sala)
    const k = gradeCol > 0 ? gradeCol : Math.max(1, Math.min(n,
      Math.ceil(Math.sqrt(n * (dispW / Math.max(1, dispH))))));
    limpaEstilosMapa(grid);
    grid.style.width = 'max-content';
    grid.style.gridTemplateColumns = `repeat(${k}, max-content)`;
    const ex = dispW / Math.max(1, grid.offsetWidth);
    const ey = dispH / Math.max(1, grid.offsetHeight);
    grid.style.transform = `scale(${Math.min(ex, ey)})`;
  }

  /**
   * Carrega estantes, caixas e a ocupação da sala escolhida e
   * monta a PLANTA do arquivo no pop-up: um quadrado por estante
   * com a grade das suas caixas. `mapaSeq` descarta a resposta
   * de uma troca anterior.
   */
  async function renderMapaArquivo() {
    const sel = document.getElementById('mapa-sala');
    const grid = document.getElementById('mapa-estantes');
    const nome = document.getElementById('mapa-sala-nome');
    const resumo = document.getElementById('mapa-resumo');
    if (!sel || !grid || !nome || !resumo) return;
    const minhaVez = ++mapaSeq;
    const salaId = sel.value;

    if (!salaId) {
      nome.hidden = true;
      grid.innerHTML = '<p class="empty-state">Selecione uma sala de arquivo para ver o mapa das caixas…</p>';
      resumo.hidden = true;
      fechaMapa();
      return;
    }

    nome.textContent = (sel.options[sel.selectedIndex] || {}).textContent || '';
    nome.hidden = false;
    grid.innerHTML = '<p class="empty-state">Carregando…</p>';
    grid.classList.remove('planta');
    limpaEstilosMapa(grid);
    try {
      const escopo = `&sala_id=eq.${encodeURIComponent(salaId)}`;
      // Estantes com linha/coluna (sql/17); banco sem as colunas
      // volta ao select antigo e o mapa estima a grade.
      const estantesComGrade = () => SGA_API.listTudo('estantes',
        `${escopo}&order=codigo,id`, 'id,codigo,descricao,linha,coluna');
      const [estantes, caixas, conta] = await Promise.all([
        estantesComGrade().catch(() =>
          SGA_API.listTudo('estantes', `${escopo}&order=codigo,id`, 'id,codigo,descricao')),
        SGA_API.listTudo('caixas', `${escopo}&order=codigo,id`,
          'id,codigo,descricao,capacidade,estante_id'),
        contarDocumentosPorCaixa(),
      ]);
      if (minhaVez !== mapaSeq) return; // outra seleção já assumiu
      desenharMapa(estantes || [], caixas || [], conta || {}, gradeDaSala(salaId));
    } catch (err) {
      if (minhaVez !== mapaSeq) return;
      grid.innerHTML = `<p class="empty-state">Erro ao montar o mapa: ${U.esc(err.message)}</p>`;
      resumo.hidden = true;
      encaixaMapa();
    }
  }

  /**
   * PLANTA DO ARQUIVO: grade única da sala — um QUADRADO por
   * ESTANTE, com a descrição da estante na extremidade de FORA
   * do quadrado e, dentro, a grade uniforme de todas as caixas
   * da estante (só a cor — verde vazia, laranja parcial, cinza
   * cheia; descrição da caixa no tooltip do mouse). O resultado
   * é medido e reduzido (scale) por encaixaMapa() para caber
   * no pop-up, sem barra de rolagem.
   *
   * `grade` (linhas x colunas da sala, quando cadastrada) comanda
   * a POSIÇÃO de cada estante na planta: a estante j nasce na
   * linha/coluna gravadas e as posições sem estante ficam
   * vazias, como na sala real. Sem `grade`, ou com estantes sem
   * posição gravada, o mapa mantém a grade estimada de sempre.
   */
  function desenharMapa(estantes, caixas, conta, grade) {
    const grid = document.getElementById('mapa-estantes');
    const resumo = document.getElementById('mapa-resumo');
    if (!grid || !resumo) return;

    if (!estantes.length && !caixas.length) {
      grid.innerHTML = '<p class="empty-state">Nenhuma estante ou caixa cadastrada nesta sala</p>';
      delete grid.dataset.linhas;
      delete grid.dataset.colunas;
      resumo.hidden = true;
      encaixaMapa();
      return;
    }

    const cmp = (a, b) =>
      String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt', { numeric: true }) ||
      String(a.id).localeCompare(String(b.id));
    const vazio = v => v === null || v === undefined || v === '';
    const inteiroPos = v => {
      const n = parseInt(v, 10);
      return n > 0 ? n : null;
    };

    const estIds = new Set(estantes.map(e => String(e.id)));

    // Caixas agrupadas por estante; sem estante (ou estante de
    // outra sala) ficam à parte num bloco extra
    const caixasPorEst = new Map();
    const semEstante = [];
    caixas.forEach(c => {
      const k = vazio(c.estante_id) ? null : String(c.estante_id);
      if (k && estIds.has(k)) {
        if (!caixasPorEst.has(k)) caixasPorEst.set(k, []);
        caixasPorEst.get(k).push(c);
      } else {
        semEstante.push(c);
      }
    });
    caixasPorEst.forEach(l => l.sort(cmp));
    semEstante.sort(cmp);

    // docsSala/capSala somam TODA a sala (incluindo as caixas sem
    // estante): docsSala = documentos arquivados; capSala = pastas
    // que as caixas da sala comportam (caixa.capacidade). O "% de
    // ocupação" da barra sai da razão entre os dois.
    let vazias = 0, parciais = 0, cheias = 0, docsSala = 0, capSala = 0;

    const quadradinho = c => {
      const docs = conta[c.id] || 0;
      const cap = vazio(c.capacidade) ? null : Number(c.capacidade);
      let pct = null;
      if (cap) {
        pct = Math.min(100, Math.round((docs / cap) * 100));
        capSala += cap;
      }
      docsSala += docs;
      const classe = (pct === 0 || (pct === null && docs === 0)) ? 'vazio'
        : (pct !== null && pct >= 100 ? 'cheia' : 'parcial');
      if (classe === 'vazio') vazias++;
      else if (classe === 'cheia') cheias++;
      else parciais++;
      const titulo = c.descricao || c.codigo || '—';
      return `<div class="mapa-quad ${classe}" title="${U.esc(titulo)}"></div>`;
    };

    /**
     * Um bloco de estante: a descrição da estante num rótulo
     * FORA do quadrado; dentro do quadrado, a grade uniforme
     * das caixas — colunas = raiz quadrada do nº de caixas,
     * para o quadrado da estante sair o mais "quadrado" possível.
     * `dimMax` guarda a maior dimensão (colunas/linhas) de toda
     * a sala: encaixaMapa() usa para dimensionar as caixas.
     * `pos` = {linha, coluna} grava a casa do bloco na grade.
     */
    let dimMax = 1;
    const blocoEstante = (rotulo, lista, pos) => {
      const n = lista.length;
      const cols = n ? Math.ceil(Math.sqrt(n)) : 1;
      const linhas = n ? Math.ceil(n / cols) : 1;
      dimMax = Math.max(dimMax, cols, linhas);
      const dentro = n
        ? `<div class="mapa-est-grade" style="grid-template-columns: repeat(${cols}, max-content)">` +
          lista.map(quadradinho).join('') + '</div>'
        : '<span class="mapa-est-vazia">sem caixas</span>';
      const casa = pos
        ? ` style="grid-row:${pos.linha};grid-column:${pos.coluna}"` : '';
      return `<section class="mapa-est"${casa}>` +
        `<span class="mapa-est-rotulo" title="${U.esc(rotulo)}">${U.esc(rotulo)}</span>` +
        `<div class="mapa-est-quadrado">${dentro}</div>` +
        '</section>';
    };

    /**
     * GRADE DA SALA: casa de cada estante. Primeiro as estantes
     * com linha/coluna gravadas (na posição de origem, desde que
     * a casa esteja livre); as demais — e o bloco "Sem estante" —
     * ocupam as casas vazias em ordem de leitura. A grade só
     * vale se couber todo mundo; se sobrar estante sem casa, o
     * mapa volta a estimar a grade como antes.
     */
    const posicionaNaGrade = () => {
      if (!grade) return null;
      const casas = new Set();
      let linhas = grade.linhas, colunas = grade.colunas;
      // Uma posição fora da grade declarada (estante remanejada
      // à mão) aumenta a grade em vez de sumir da planta.
      estantes.forEach(e => {
        const l = inteiroPos(e.linha), c = inteiroPos(e.coluna);
        if (l && c) {
          linhas = Math.max(linhas, l);
          colunas = Math.max(colunas, c);
        }
      });

      const casaDe = (l, c) => casas.add(`${l}|${c}`);
      const buscaLivre = () => {
        for (let l = 1; l <= linhas; l++) {
          for (let c = 1; c <= colunas; c++) {
            if (!casas.has(`${l}|${c}`)) return { linha: l, coluna: c };
          }
        }
        return null;
      };

      const fixas = new Map();
      // 1ª passada: posição gravada (duplicada cai para as livres)
      estantes.forEach(e => {
        const l = inteiroPos(e.linha), c = inteiroPos(e.coluna);
        if (!l || !c || casas.has(`${l}|${c}`)) return;
        casaDe(l, c);
        fixas.set(String(e.id), { linha: l, coluna: c });
      });
      // 2ª passada: estantes sem posição -> 1ª casa livre
      estantes.forEach(e => {
        if (fixas.has(String(e.id))) return;
        const p = buscaLivre();
        if (!p) return;
        casaDe(p.linha, p.coluna);
        fixas.set(String(e.id), p);
      });
      // Bloco "Sem estante": só entra na grade se couber
      const pSem = semEstante.length ? buscaLivre() : null;
      if (pSem) casaDe(pSem.linha, pSem.coluna);

      if (fixas.size !== estantes.length || (semEstante.length && !pSem)) {
        return null;  // não coube tudo — mantém a grade estimada
      }
      return { linhas, colunas, fixas, semEstante: pSem };
    };

    const planta = posicionaNaGrade();
    const posDe = e => (planta ? planta.fixas.get(String(e.id)) || null : null);

    const blocos = estantes.map(e =>
      blocoEstante(e.descricao || e.codigo || '—',
        caixasPorEst.get(String(e.id)) || [], posDe(e)));
    if (semEstante.length) {
      blocos.push(blocoEstante('Sem estante', semEstante,
        planta ? planta.semEstante : null));
    }

    // Medidas que encaixaMapa() precisa para distribuir/aumentar
    grid.dataset.blocos = String(blocos.length);
    grid.dataset.dimmax = String(dimMax);
    if (planta) {
      grid.dataset.linhas = String(planta.linhas);
      grid.dataset.colunas = String(planta.colunas);
    } else {
      delete grid.dataset.linhas;
      delete grid.dataset.colunas;
    }
    grid.innerHTML = blocos.join('');

    // Barra de informação da sala: contagens + % de ocupação da
    // SALA = documentos arquivados / capacidade de arquivamento
    // (soma das pastas de todas as caixas da sala).
    const ocupacao = capSala > 0 ? Math.round((docsSala / capSala) * 100) : null;
    resumo.textContent =
      `${estantes.length} estante · ${caixas.length} caixa · ${vazias} vazia · ` +
      `${parciais} parcial · ${cheias} cheia` +
      (ocupacao !== null ? ` · ${ocupacao}% de ocupação` : '');
    resumo.hidden = false;
    encaixaMapa();
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
      caixas = await SGA_API.listTudo('caixas', '&order=codigo',
        'id,codigo,descricao,sala:salas(codigo),prateleira:prateleiras(codigo)');
    } catch { /* mantém lista vazia */ }
    // o codigo da caixa e unico DENTRO da sala, mas se repete em
    // outra sala: sala + prateleira desambiguam a opcao
    const opsCaixa = (caixas || [])
      .map(c => {
        const loc = [c.sala?.codigo, c.prateleira?.codigo].filter(Boolean).join(' / ');
        return `<option value="${U.esc(c.id)}">${U.esc(c.codigo)}${loc ? ' (' + U.esc(loc) + ')' : ''}${c.descricao ? ' — ' + U.esc(c.descricao) : ''}</option>`;
      })
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

    // Próximo código da sala na aba "Gerar Sala de Arquivo"
    refreshCodigos();

    // ---------- Gerar Sala de Arquivo ----------
    // Mesmo conceito do cadastro manual: os códigos vêm todos da
    // sequência do banco (gerar_codigo com escopo por nível), só
    // que de uma vez só — a RPC cria a sala e a estrutura inteira
    // em uma transação (sql/17_gerar_sala_arquivo_linha_coluna.sql).
    // A sala é gerada SEM corredores: a quantidade de estantes é
    // livre e a estrutura é estante -> prateleira -> caixa.
    // LINHA x COLUNA é a grade da sala: as estantes ocupam as
    // posições em ordem de leitura (linha 1/coluna 1 em diante) e
    // cada estante nasce com a sua linha/coluna gravada.
    const formGerar = document.getElementById('form-gerar-sala');
    const resumoGerar = document.getElementById('gerar-resumo');

    const quantidadesGerar = () => {
      const n = id => parseInt(document.getElementById(id).value, 10) || 0;
      const est = n('gerar-estantes');
      const prat = n('gerar-prateleiras');
      const cx = n('gerar-caixas');
      const lin = n('gerar-linha');
      const col = n('gerar-coluna');
      return {
        est, prat, cx, lin, col,
        grade: lin * col,
        estantes: est,
        prateleiras: est * prat,
        caixas: est * prat * cx,
      };
    };

    const mostraResumoGerar = prefixo => {
      const t = quantidadesGerar();
      resumoGerar.textContent =
        `${prefixo}${t.lin} linha(s) x ${t.col} coluna(s) · ` +
        `${t.estantes} estante(s) · ` +
        `${t.prateleiras} prateleira(s) · ${t.caixas} caixa(s)` +
        (t.est > t.grade ? ' · grade insuficiente' : '');
    };

    formGerar.addEventListener('input', () => mostraResumoGerar('Vai gerar: '));
    mostraResumoGerar('Vai gerar: ');

    formGerar.addEventListener('submit', async e => {
      e.preventDefault();
      const nome = document.getElementById('gerar-nome').value.trim();
      const t = quantidadesGerar();
      if (!nome) { U.toast('Informe o nome da sala.', 'warning'); return; }
      if (t.lin < 1 || t.col < 1 || t.est < 1 || t.prat < 1 || t.cx < 1) {
        U.toast('Informe as quantidades (mínimo 1 em cada campo).', 'warning'); return;
      }
      if (t.lin > 100 || t.col > 100) {
        U.toast('Máximo de 100 linhas e 100 colunas.', 'warning'); return;
      }
      if (t.est > t.grade) {
        U.toast(`A grade ${t.lin} linha(s) x ${t.col} coluna(s) comporta no máximo ` +
                `${t.grade} estante(s). Informe ${t.grade} ou menos.`, 'warning'); return;
      }
      if (t.prat > 8) { U.toast('Máximo de 8 prateleiras por estante.', 'warning'); return; }
      if (t.cx > 4) { U.toast('Máximo de 4 caixas por prateleira.', 'warning'); return; }
      if (t.estantes > 10000) {
        U.toast('Quantidade de estantes acima de 10000. Reduza.', 'warning'); return;
      }
      if (t.caixas > 10000) {
        U.toast('Total de caixas acima de 10000. Reduza as quantidades.', 'warning'); return;
      }

      const btn = document.getElementById('btn-gerar-sala');
      U.loading(btn, true);
      try {
        const r = await SGA_API.gerarSalaArquivo({
          nome,
          estantes: t.estantes,
          prateleiras: t.prat,
          caixas: t.cx,
          linhas: t.lin,
          colunas: t.col,
        });
        U.toast(`Sala ${r.sala_codigo} gerada com sucesso!`, 'success');
        formGerar.reset();
        resumoGerar.textContent =
          `Sala ${r.sala_codigo} gerada (${t.lin}x${t.col}): ` +
          `${r.estantes} estante(s) · ` +
          `${r.prateleiras} prateleira(s) · ${r.caixas} caixa(s).`;
        // Atualiza os selects de sala (Editar Arquivo e
        // Documento) e o mapa do Painel, e já deixa a sala
        // recem-gerada aberta no editor.
        refreshCodigos();
        await loadLocalSelects();
        sincronizaEditorSala(r.sala_id);
      } catch (err) {
        U.toast(err.message, 'error');
      } finally {
        U.loading(btn, false);
      }
    });

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
      const salaDoc = document.getElementById('doc-sala').value;
      const observacoes = document.getElementById('doc-observacoes').value.trim();

      if (!descricao) { U.setError('doc-descricao', 'O nome é obrigatório.'); ok = false; }
      if (!tipo) { U.setError('doc-tipo', 'Informe o tipo.'); ok = false; }
      if (!setor) { U.setError('doc-setor', 'Selecione o setor.'); ok = false; }
      if (!categoria) { U.setError('doc-categoria', 'Selecione a categoria.'); ok = false; }
      if (!dataDoc) { U.setError('doc-data', 'Informe a data do documento.'); ok = false; }
      if (!prazo) { U.setError('doc-prazo', 'Informe o prazo de guarda.'); ok = false; }
      if (!salaDoc) { U.setError('doc-sala', 'Selecione a sala.'); ok = false; }
      else if (!caixa) { U.setError('doc-sala', 'Nenhuma caixa livre nesta sala.'); ok = false; }
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
        alocarCaixaPorSala();
      } catch (err) {
        U.toast(`Erro ao salvar: ${err.message}`, 'error');
      } finally {
        U.loading(btn, false);
      }
    });

    // ---------- Editar Arquivo ----------
    // Sala escolhida + arvore estante > prateleira > caixa
    // (incluir, remover e transferir). A arvore e desenhada em
    // renderEstrutura() e as acoes chegam por delegacao de evento.
    initEditarArquivo();

    // Documento: ao escolher a sala, aloca sozinho a 1ª caixa livre
    document.getElementById('doc-sala').addEventListener('change', alocarCaixaPorSala);

    // Carregamentos iniciais
    loadLocalSelects();
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

  /**
   * Exibe no campo de Código (somente leitura) da aba "Gerar Sala
   * de Arquivo" o próximo código da sequência global de salas
   * (SL-001). Apenas visualização: quem reserva é o submit
   * (gerar_codigo).
   *
   * As sequências das localizações (corredor, estante, prateleira
   * e caixa) NÃO aparecem mais em campo de código: são geradas
   * dentro das telas de inclusão/transferência da aba Editar
   * Arquivo, já com o escopo (sala/estante) resolvido.
   */
  async function refreshCodigos() {
    const el = document.getElementById('gerar-codigo');
    if (!el) return;
    const cod = await SGA_API.proximoCodigo('salas');
    if (cod) el.value = cod;
  }

  let salasCache = [];

  async function loadLocalSelects() {
    try {
      // capacidade/linha/coluna: 12_capacidade e 17_gerar_sala_arquivo.
      // Banco sem as colunas volta para a seleção mínima.
      const salas = await SGA_API.listTudo('salas', '&order=codigo', 'id,codigo,descricao,capacidade,linha,coluna')
        .catch(() => SGA_API.listTudo('salas', '&order=codigo', 'id,codigo,descricao').catch(() => []));

      salasCache = salas || [];

      fillSelect('ed-sala', salas, 'Selecione a sala…');
      fillSelect('doc-sala', salas, 'Selecione a sala…');

      alocarCaixaPorSala();
      sincronizaEditorSala();
    } catch (err) {
      // silencioso no carregamento inicial (tabelas podem ainda não existir)
      console.warn('loadLocalSelects:', err.message);
    }
  }

  /* ============================================================
     SEÇÃO: EDITAR ARQUIVO
     Escolhe uma sala, edita os dados dela e administra a árvore
     estante > prateleira > caixa: incluir, remover e transferir.

     Inclusões usam o mesmo caminho do antigo cadastro manual
     (gerar_codigo + insert); remoções e transferências são
     transações no banco, porque cascateiam e renumeram códigos
     (sql/18_editar_sala_arquivo.sql).
     ============================================================ */

  const MAX_PRAT_ESTANTE = 8;   // prateleiras por estante
  const MAX_CX_PRAT = 4;       // caixas por prateleira
  const MAX_CAP_CAIXA = 5;     // pastas por caixa

  const edArq = {
    salaId: null,
    sala: null,
    estantes: [],
    prateleiras: [],
    caixas: [],
    docs: {},        // { caixa_id: documentos }
    busca: '',     // filtro do painel Pesquisa
    seq: 0,          // descarta resposta de uma troca anterior
  };

  /** Ordem de leitura dos códigos (E-002 antes de E-010). */
  const cmpCodigo = (a, b) =>
    String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt', { numeric: true }) ||
    String(a.id).localeCompare(String(b.id));

  function initEditarArquivo() {
    const sel = document.getElementById('ed-sala');
    const form = document.getElementById('form-editar-sala');
    const box = document.getElementById('ed-estrutura');
    if (!sel || !form || !box) return;

    sel.addEventListener('change', () => selecionarSalaEditor(sel.value));
    form.addEventListener('submit', e => { e.preventDefault(); salvarSalaEditor(); });
    form.addEventListener('input', validaGradeSala);
    const btnEst = document.getElementById('btn-ed-incluir-estante');
    if (btnEst) btnEst.addEventListener('click', incluirEstante);

    // ---------- Pesquisa (filtra a árvore da sala escolhida) ----------
    const formBusca = document.getElementById('form-ed-busca');
    const busca = document.getElementById('ed-busca');
    const btnLimpar = document.getElementById('btn-ed-limpar-busca');
    if (formBusca && busca) {
      formBusca.addEventListener('submit', e => { e.preventDefault(); aplicarBusca(); });
      // Filtra enquanto digita: o botão Buscar cobre o Enter e fica
      // como confirmação explícita para quem preferir não filtrar ao vivo.
      busca.addEventListener('input', aplicarBusca);
      if (btnLimpar) btnLimpar.addEventListener('click', () => {
        busca.value = '';
        aplicarBusca();
      });
    }

    // Delegação: as linhas da árvore nascem a cada render
    box.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('button[data-acao]');
      if (!btn || btn.disabled) return;
      const d = btn.dataset;
      if (d.acao === 'add-prat') incluirPrateleira(d.est);
      else if (d.acao === 'add-cx') incluirCaixa(d.prat);
      else if (d.acao === 'mover-est') transferirEstante(d.est);
      else if (d.acao === 'mover-cx') transferirCaixa(d.cx);
      else if (d.acao === 'rm-est') removerEstante(d.est);
      else if (d.acao === 'rm-prat') removerPrateleira(d.prat);
      else if (d.acao === 'rm-cx') removerCaixa(d.cx);
    });

    sincronizaEditorSala();
  }

  /**
   * Reposiciona o editor depois que loadLocalSelects() recria o
   * select: mantém a sala aberta quando ela ainda existe, limpa a
   * tela quando foi removida e abre a sala recém-gerada.
   */
  function sincronizaEditorSala(salaPreferida) {
    const sel = document.getElementById('ed-sala');
    if (!sel) return;
    if (salaPreferida && String(sel.value) !== String(salaPreferida)) {
      selecionarSalaEditor(salaPreferida);
      return;
    }
    if (!sel.value) {
      edArq.salaId = null;
      edArq.sala = null;
      limparEditor();
      return;
    }
    if (String(sel.value) !== String(edArq.salaId)) selecionarSalaEditor(sel.value);
  }

  function selecionarSalaEditor(salaId) {
    const sel = document.getElementById('ed-sala');
    if (sel && String(sel.value) !== String(salaId || '')) {
      sel.value = salaId ? String(salaId) : '';
    }
    const sala = salasCache.find(s => String(s.id) === String(salaId || ''));
    if (!salaId || !sala) { limparEditor(); return; }
    edArq.salaId = sala.id;
    edArq.sala = sala;
    preencheCamposSala(sala);
    carregarEstruturaSala();
  }

  function preencheCamposSala(sala) {
    const v = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.value = valor === null || valor === undefined ? '' : valor;
    };
    v('ed-sala-codigo', sala.codigo);
    v('ed-sala-descricao', sala.descricao);
    v('ed-sala-capacidade', sala.capacidade);
    v('ed-sala-linha', sala.linha);
    v('ed-sala-coluna', sala.coluna);
    const salvar = document.getElementById('btn-salvar-sala');
    if (salvar) salvar.disabled = false;
    const btnEst = document.getElementById('btn-ed-incluir-estante');
    if (btnEst) btnEst.disabled = false;
    const btnBuscar = document.getElementById('btn-ed-buscar');
    if (btnBuscar) btnBuscar.disabled = false;
    const btnLimpar = document.getElementById('btn-ed-limpar-busca');
    if (btnLimpar) btnLimpar.disabled = !edArq.busca;
    validaGradeSala();
  }

  function limparEditor() {
    ['ed-sala-codigo', 'ed-sala-descricao', 'ed-sala-capacidade', 'ed-sala-linha', 'ed-sala-coluna']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    ['btn-salvar-sala', 'btn-ed-incluir-estante', 'btn-ed-buscar',
      'btn-ed-limpar-busca'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    const aviso = document.getElementById('ed-sala-aviso');
    if (aviso) aviso.hidden = true;
    const resumo = document.getElementById('ed-busca-resumo');
    if (resumo) { resumo.hidden = true; resumo.textContent = ''; }
    const busca = document.getElementById('ed-busca');
    if (busca) busca.value = '';
    const box = document.getElementById('ed-estrutura');
    if (box) box.innerHTML = '<p class="empty-state">Selecione uma sala para ver a estrutura.</p>';
    edArq.busca = '';
    edArq.estantes = [];
    edArq.prateleiras = [];
    edArq.caixas = [];
    edArq.docs = {};
  }

  /**
   * Aplica o filtro do painel Pesquisa. Sem termo, desenha a sala
   * inteira; com termo, mantém a hierarquia visível: uma estante que
   * bate aparece inteira, e uma prateleira/caixa que bate aparece
   * dentro da sua estante/prateleira (com as irmãs também, para o
   * usuário não perder o contexto de onde o item está).
   */
  function aplicarBusca() {
    const busca = document.getElementById('ed-busca');
    edArq.busca = busca ? busca.value : '';
    if (!edArq.salaId) return;
    renderEstrutura();
  }

  async function carregarEstruturaSala() {
    const box = document.getElementById('ed-estrutura');
    const salaId = edArq.salaId;
    if (!box || !salaId) return;
    const minhaVez = ++edArq.seq;
    box.innerHTML = '<p class="empty-state">Carregando…</p>';
    const escopo = `&sala_id=eq.${encodeURIComponent(salaId)}`;
    try {
      const [estantes, prateleiras, caixas, docs] = await Promise.all([
        // linha/coluna só existem após o 17; banco sem elas não quebra o editor
        SGA_API.listTudo('estantes', `${escopo}&order=codigo,id`,
          'id,codigo,descricao,capacidade,linha,coluna')
          .catch(() => SGA_API.listTudo('estantes', `${escopo}&order=codigo,id`,
            'id,codigo,descricao,capacidade')),
        SGA_API.listTudo('prateleiras', '&order=codigo,id',
          'id,codigo,descricao,capacidade,estante_id'),
        SGA_API.listTudo('caixas', `${escopo}&order=codigo,id`,
          'id,codigo,descricao,capacidade,estante_id,prateleira_id'),
        contarDocumentosPorCaixa(),
      ]);
      if (minhaVez !== edArq.seq) return; // outra seleção já assumiu
      const idsEst = new Set((estantes || []).map(e => String(e.id)));
      edArq.estantes = estantes || [];
      edArq.prateleiras = (prateleiras || []).filter(p => idsEst.has(String(p.estante_id)));
      edArq.caixas = caixas || [];
      edArq.docs = docs || {};
      renderEstrutura();
      validaGradeSala();
    } catch (err) {
      if (minhaVez !== edArq.seq) return;
      box.innerHTML = `<p class="empty-state">Erro ao carregar: ${U.esc(err.message)}</p>`;
    }
  }

  /** Agrupa por atributo preservando a ordem de código. */
  function agrupaPor(rows, campo) {
    const mapa = new Map();
    rows.forEach(r => {
      const k = String(r[campo]);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(r);
    });
    mapa.forEach(lista => lista.sort(cmpCodigo));
    return mapa;
  }

  function renderEstrutura() {
    const box = document.getElementById('ed-estrutura');
    if (!box) return;
    const pratsPorEst = agrupaPor(edArq.prateleiras, 'estante_id');
    const cxsPorPrat = agrupaPor(edArq.caixas, 'prateleira_id');
    const cxsPorEst = agrupaPor(edArq.caixas, 'estante_id');

    // ---------- Filtro do painel Pesquisa ----------
    // Sem termo: desenha a sala inteira. Com termo, a hierarquia é
    // preservada — se bateu na estante, vem a estante inteira; se
    // bateu dentro dela, vem a prateleira/caixa que bateu E as
    // irmãs, para o usuário não perder o contexto de onde está.
    const termo = (edArq.busca || '').trim().toLowerCase();
    const bate = (...vals) => !termo
      || vals.some(v => v !== null && v !== undefined && v !== ''
        && String(v).toLowerCase().includes(termo));
    const bateCx = c => bate(c.codigo, c.descricao, c.capacidade);
    const batePrat = p => bate(p.codigo, p.descricao, p.capacidade)
      || (cxsPorPrat.get(String(p.id)) || []).some(bateCx);

    const todas = [...edArq.estantes].sort(cmpCodigo);
    const estantes = termo
      ? todas.filter(e => bate(e.codigo, e.descricao, e.capacidade)
        || (pratsPorEst.get(String(e.id)) || []).some(batePrat)
        || (cxsPorEst.get(String(e.id)) || []).some(bateCx))
      : todas;

    const nPratTotal = edArq.prateleiras.length;
    const nCxTotal = edArq.caixas.length;
    let nPratVista = 0, nCxVista = 0;
    const limpar = document.getElementById('btn-ed-limpar-busca');
    if (limpar) limpar.disabled = !termo;
    // O resumo é escrito DEPOIS do desenho: as contagens crescem
    // enquanto as linhas são montadas.
    const escreveResumo = () => {
      const resumo = document.getElementById('ed-busca-resumo');
      if (!resumo) return;
      resumo.textContent = termo
        ? `Filtro “${edArq.busca.trim()}”: ${estantes.length}/${todas.length} estante(s), `
          + `${nPratVista}/${nPratTotal} prateleira(s), ${nCxVista}/${nCxTotal} caixa(s)`
        : '';
      resumo.hidden = !termo;
    };

    if (!estantes.length) {
      box.innerHTML = termo
        ? `<p class="ed-vazio-sala">Nada corresponde ao filtro <strong>${U.esc(edArq.busca.trim())}</strong>
             nesta sala. Use <strong>Limpar</strong> para ver a estrutura inteira.</p>`
        : '<p class="ed-vazio-sala">Nenhuma estante nesta sala. '
          + 'Use o botão <strong>+ Incluir estante</strong>.</p>';
      escreveResumo();
      return;
    }

    box.innerHTML = estantes.map(e => {
      // Com filtro, uma estante que bateu sozinha mostra tudo; se a
      // estante apareceu por causa de uma prateleira/caixa que bateu,
      // só o que bateu é desenhado (mais as irmãs, para não perder o
      // contexto de onde o item está).
      const estBateSozinha = !termo || bate(e.codigo, e.descricao, e.capacidade);
      const todasPrats = pratsPorEst.get(String(e.id)) || [];
      const prats = estBateSozinha
        ? todasPrats
        : todasPrats.filter(batePrat);
      const totalCx = (cxsPorEst.get(String(e.id)) || []).length;
      const pos = (e.linha > 0 && e.coluna > 0) ? `<span class="badge">L${e.linha} C${e.coluna}</span>` : '';
      // O limite é sempre o da estante INTEIRA, não o do trecho filtrado:
      // filtrar não libera espaço para incluir mais.
      const cabePrat = todasPrats.length < MAX_PRAT_ESTANTE ? '' : ' disabled';
      nPratVista += prats.length;

      const htmlPrats = prats.map(p => {
        const todasCxs = cxsPorPrat.get(String(p.id)) || [];
        const cxs = estBateSozinha || bate(p.codigo, p.descricao, p.capacidade)
          ? todasCxs : todasCxs.filter(bateCx);
        const cabeCx = todasCxs.length < MAX_CX_PRAT ? '' : ' disabled';
        nCxVista += cxs.length;
        const htmlCx = cxs.map(c => {
          const n = edArq.docs[c.id] || 0;
          const cap = c.capacidade || MAX_CAP_CAIXA;
          return `<span class="ed-caixa" title="${U.esc(c.descricao || c.codigo)}">`
            + `<span class="ed-caixa-cod">${U.esc(c.codigo)}</span>`
            + `<span class="ed-caixa-cap">${n}/${cap}</span>`
            + `<span class="ed-acoes">`
            + `<button class="btn btn-ghost btn-icone" data-acao="mover-cx" data-cx="${U.esc(c.id)}"`
            + ` title="Transferir caixa">⇄</button>`
            + `<button class="btn btn-ghost btn-icone" data-acao="rm-cx" data-cx="${U.esc(c.id)}"`
            + ` title="Remover caixa">✕</button>`
            + `</span></span>`;
        }).join('');

        return `<div class="ed-prateleira">`
          + `<div class="ed-prateleira-topo">`
          + `<span class="ed-nome">${U.esc(p.codigo)}</span>`
          + (p.descricao ? `<span class="ed-meta">${U.esc(p.descricao)}</span>` : '')
          + `<span class="ed-meta">${cxs.length}/${p.capacidade || MAX_CX_PRAT} caixas</span>`
          + `<span class="ed-acoes">`
          + `<button class="btn btn-ghost btn-icone" data-acao="add-cx" data-prat="${U.esc(p.id)}"`
          + `${cabeCx} title="Incluir caixa">+ Caixa</button>`
          + `<button class="btn btn-ghost btn-icone" data-acao="rm-prat" data-prat="${U.esc(p.id)}"`
          + ` title="Remover prateleira">✕</button>`
          + `</span></div>`
          + `<div class="ed-caixas">${htmlCx || '<span class="ed-meta">Sem caixas.</span>'}</div>`
          + `</div>`;
      }).join('');

      return `<section class="ed-estante">`
        + `<header class="ed-estante-topo">`
        + `<span class="ed-nome">${U.esc(e.codigo)}</span>`
        + (e.descricao ? `<span class="ed-meta">${U.esc(e.descricao)}</span>` : '')
        + pos
        + `<span class="ed-meta">${todasPrats.length}/${e.capacidade || MAX_PRAT_ESTANTE} prateleiras · ${totalCx} caixa(s)</span>`
        + `<span class="ed-acoes">`
        + `<button class="btn btn-ghost btn-icone" data-acao="add-prat" data-est="${U.esc(e.id)}"`
        + `${cabePrat} title="Incluir prateleira">+ Prateleira</button>`
        + `<button class="btn btn-ghost btn-icone" data-acao="mover-est" data-est="${U.esc(e.id)}"`
        + ` title="Transferir estante">⇄</button>`
        + `<button class="btn btn-ghost btn-icone" data-acao="rm-est" data-est="${U.esc(e.id)}"`
        + ` title="Remover estante">✕</button>`
        + `</span></header>`
        + `<div class="ed-prateleiras">${htmlPrats || '<span class="ed-meta">Sem prateleiras.</span>'}</div>`
        + `</section>`;
    }).join('');

    escreveResumo();
  }

  /**
   * A grade (linha x coluna) é física: as estantes já posicionadas
   * não podem ficar de fora dela. A capacidade é apenas meta, então
   * ficar abaixo da quantidade de estantes é aviso, não bloqueio.
   */
  function validaGradeSala() {
    const aviso = document.getElementById('ed-sala-aviso');
    if (!aviso) return true;
    const linha = parseInt(document.getElementById('ed-sala-linha').value, 10) || 0;
    const coluna = parseInt(document.getElementById('ed-sala-coluna').value, 10) || 0;
    const cap = parseInt(document.getElementById('ed-sala-capacidade').value, 10) || 0;
    const msgs = [];
    let ok = true;

    if (linha > 0 && coluna > 0) {
      const fora = edArq.estantes.filter(e =>
        e.linha > 0 && e.coluna > 0 && (e.linha > linha || e.coluna > coluna));
      if (fora.length) {
        ok = false;
        msgs.push(`${fora.length} estante(s) ficariam fora da grade ${linha}x${coluna}.`);
      }
    }
    if (cap > 0 && edArq.estantes.length > cap) {
      msgs.push(`A capacidade (${cap}) é menor que as ${edArq.estantes.length} estante(s) existentes.`);
    }

    aviso.textContent = msgs.join(' ');
    aviso.classList.toggle('erro', !ok);
    aviso.hidden = !msgs.length;
    return ok;
  }

  async function salvarSalaEditor() {
    if (!edArq.sala) return;
    const form = document.getElementById('form-editar-sala');
    U.clearErrors(form);

    const descricao = document.getElementById('ed-sala-descricao').value.trim();
    const capacidade = parseInt(document.getElementById('ed-sala-capacidade').value, 10);
    const linha = parseInt(document.getElementById('ed-sala-linha').value, 10);
    const coluna = parseInt(document.getElementById('ed-sala-coluna').value, 10);

    let ok = true;
    if (!capacidade) { U.setError('ed-sala-capacidade', 'Informe a capacidade.'); ok = false; }
    if (!(linha >= 1)) { U.setError('ed-sala-linha', 'Mínimo 1.'); ok = false; }
    if (!(coluna >= 1)) { U.setError('ed-sala-coluna', 'Mínimo 1.'); ok = false; }
    if (linha > 100) { U.setError('ed-sala-linha', 'Máximo 100.'); ok = false; }
    if (coluna > 100) { U.setError('ed-sala-coluna', 'Máximo 100.'); ok = false; }
    if (!ok) return;
    if (!validaGradeSala()) {
      U.toast('A grade nova não comporta as estantes existentes. Ajuste a grade ou remova as estantes.', 'warning');
      return;
    }

    const btn = document.getElementById('btn-salvar-sala');
    U.loading(btn, true);
    try {
      await SGA_API.update('salas', edArq.sala.id, {
        descricao: descricao || null,
        capacidade,
        linha,
        coluna,
      });
      U.toast(`Sala ${edArq.sala.codigo} atualizada!`, 'success');
      loadLocalSelects();
      selecionarSalaEditor(edArq.sala.id);
    } catch (err) {
      U.toast(err.message, 'error');
    } finally {
      U.loading(btn, false);
    }
  }

  /**
   * Primeira casa livre da grade da sala (ordem de leitura). Sala
   * cadastrada antes do sql/17 não tem grade: devolve {} e a estante
   * entra sem posição (a planta do mapa estima a grade).
   */
  function primeiraCelulaLivre() {
    const sala = edArq.sala || {};
    const linhas = parseInt(sala.linha, 10) || 0;
    const colunas = parseInt(sala.coluna, 10) || 0;
    if (!(linhas > 0) || !(colunas > 0)) return {};
    const ocupadas = new Set(
      edArq.estantes.filter(e => e.linha > 0 && e.coluna > 0).map(e => `${e.linha}x${e.coluna}`));
    for (let l = 1; l <= linhas; l++) {
      for (let c = 1; c <= colunas; c++) {
        if (!ocupadas.has(`${l}x${c}`)) return { linha: l, coluna: c };
      }
    }
    return null;
  }

  /** Botões padrão do modal de inclusão/transferência. */
  function botoesModal(acao) {
    return '<button class="btn btn-ghost" id="edf-cancelar">Cancelar</button>'
      + `<button class="btn btn-primary" id="edf-confirmar">${U.esc(acao)}</button>`;
  }

  function ligaBotoesModal(acao, aoConfirmar) {
    const cancelar = document.getElementById('edf-cancelar');
    const confirmar = document.getElementById('edf-confirmar');
    if (cancelar) cancelar.addEventListener('click', () => Modal.close());
    if (confirmar) confirmar.addEventListener('click', async e => {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      U.loading(btn, true);
      try {
        await aoConfirmar();
      } catch (err) {
        U.toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        U.loading(btn, false);
      }
    });
  }

  /** <option>s de um destino, com código + descrição. */
  function opcoesDestino(rows, placeholder) {
    return `<option value="">${U.esc(placeholder)}</option>`
      + (rows || []).map(r => `<option value="${U.esc(r.id)}">${U.esc(r.codigo)}`
        + (r.descricao ? ' — ' + U.esc(r.descricao) : '') + '</option>').join('');
  }

  async function incluirEstante() {
    if (!edArq.sala) return;
    const celula = primeiraCelulaLivre();
    if (!celula) {
      const l = edArq.sala.linha || '?', c = edArq.sala.coluna || '?';
      U.toast(`A grade da sala (${l}x${c}) está cheia. `
        + 'Aumente a grade da sala ou transfira alguma estante para outra sala.', 'warning');
      return;
    }

    const posTexto = celula.linha
      ? `Linha ${celula.linha}, coluna ${celula.coluna}`
      : 'Sala sem grade — a estante entra sem posição';

    Modal.open('Incluir estante', `
      <form class="form-stack" onsubmit="return false">
        <div class="form-group">
          <label for="edf-est-pos">Posição na grade</label>
          <input type="text" id="edf-est-pos" value="${posTexto}" readonly>
        </div>
        <div class="form-group">
          <label for="edf-est-descricao">Descrição</label>
          <input type="text" id="edf-est-descricao" maxlength="120" placeholder="Ex.: Estante do fundo">
        </div>
        <div class="form-group">
          <label for="edf-est-capacidade">Capacidade (prateleiras) — máx. ${MAX_PRAT_ESTANTE}</label>
          <input type="number" id="edf-est-capacidade" min="1" max="${MAX_PRAT_ESTANTE}" value="${MAX_PRAT_ESTANTE}">
        </div>
      </form>`, botoesModal('Incluir'));

    ligaBotoesModal('Incluir', async () => {
      const capacidade = parseInt(document.getElementById('edf-est-capacidade').value, 10);
      if (!(capacidade >= 1 && capacidade <= MAX_PRAT_ESTANTE)) {
        U.toast(`Capacidade entre 1 e ${MAX_PRAT_ESTANTE} prateleiras.`, 'warning');
        return;
      }
      const codigo = await SGA_API.gerarCodigo('estantes', edArq.sala.id);
      await SGA_API.insert('estantes', {
        codigo,
        sala_id: edArq.sala.id,
        capacidade,
        linha: celula.linha || null,
        coluna: celula.coluna || null,
        descricao: document.getElementById('edf-est-descricao').value.trim() || null,
      });
      Modal.close();
      U.toast(`Estante ${codigo} incluída!`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    });
  }

  async function incluirPrateleira(estanteId) {
    if (!edArq.sala) return;
    const est = edArq.estantes.find(e => String(e.id) === String(estanteId));
    if (!est) return;
    const existentes = edArq.prateleiras.filter(p => String(p.estante_id) === String(est.id)).length;
    if (existentes >= MAX_PRAT_ESTANTE) {
      U.toast(`A estante ${est.codigo} já tem ${MAX_PRAT_ESTANTE} prateleiras (máximo).`, 'warning');
      return;
    }

    Modal.open(`Incluir prateleira em ${est.codigo}`, `
      <form class="form-stack" onsubmit="return false">
        <div class="form-group">
          <label for="edf-prat-descricao">Descrição</label>
          <input type="text" id="edf-prat-descricao" maxlength="120" placeholder="Ex.: Prateleira superior">
        </div>
        <div class="form-group">
          <label for="edf-prat-capacidade">Capacidade (caixas) — máx. ${MAX_CX_PRAT}</label>
          <input type="number" id="edf-prat-capacidade" min="1" max="${MAX_CX_PRAT}" value="${MAX_CX_PRAT}">
        </div>
      </form>`, botoesModal('Incluir'));

    ligaBotoesModal('Incluir', async () => {
      const capacidade = parseInt(document.getElementById('edf-prat-capacidade').value, 10);
      if (!(capacidade >= 1 && capacidade <= MAX_CX_PRAT)) {
        U.toast(`Capacidade entre 1 e ${MAX_CX_PRAT} caixas.`, 'warning');
        return;
      }
      const codigo = await SGA_API.gerarCodigo('prateleiras', est.id);
      await SGA_API.insert('prateleiras', {
        codigo,
        estante_id: est.id,
        capacidade,
        descricao: document.getElementById('edf-prat-descricao').value.trim() || null,
      });
      Modal.close();
      U.toast(`Prateleira ${codigo} incluída!`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    });
  }

  async function incluirCaixa(prateleiraId) {
    if (!edArq.sala) return;
    const prat = edArq.prateleiras.find(p => String(p.id) === String(prateleiraId));
    if (!prat) return;
    const existentes = edArq.caixas.filter(c => String(c.prateleira_id) === String(prat.id)).length;
    if (existentes >= MAX_CX_PRAT) {
      U.toast(`A prateleira ${prat.codigo} já tem ${MAX_CX_PRAT} caixas (máximo).`, 'warning');
      return;
    }

    // Só EXIBE o próximo código da sequência da sala: quem reserva
    // é o gerar_codigo do submit (nada é consumido ao abrir o modal).
    let proximo = '';
    try {
      proximo = (await SGA_API.proximoCodigo('caixas', edArq.sala.id)) || '';
    } catch { /* banco sem a RPC: campo fica vazio */ }

    Modal.open(`Incluir caixa em ${prat.codigo}`, `
      <form class="form-stack" onsubmit="return false">
        <div class="form-group">
          <label for="edf-cx-codigo">Código</label>
          <input type="text" id="edf-cx-codigo" value="${U.esc(proximo)}" readonly
            placeholder="Gerado ao incluir">
        </div>
        <div class="form-group">
          <label for="edf-cx-descricao">Descrição</label>
          <input type="text" id="edf-cx-descricao" maxlength="120" placeholder="Opcional">
        </div>
        <div class="form-group">
          <label for="edf-cx-capacidade">Capacidade (pastas) — máx. ${MAX_CAP_CAIXA}</label>
          <input type="number" id="edf-cx-capacidade" min="1" max="${MAX_CAP_CAIXA}" value="${MAX_CAP_CAIXA}">
        </div>
      </form>`, botoesModal('Incluir'));

    ligaBotoesModal('Incluir', async () => {
      const capacidade = parseInt(document.getElementById('edf-cx-capacidade').value, 10);
      if (!(capacidade >= 1 && capacidade <= MAX_CAP_CAIXA)) {
        U.toast(`Capacidade entre 1 e ${MAX_CAP_CAIXA} pastas.`, 'warning');
        return;
      }
      const codigo = await SGA_API.gerarCodigo('caixas', edArq.sala.id);
      await SGA_API.insert('caixas', {
        codigo,
        sala_id: edArq.sala.id,
        estante_id: prat.estante_id,
        prateleira_id: prat.id,
        capacidade,
        descricao: document.getElementById('edf-cx-descricao').value.trim() || null,
      });
      Modal.close();
      U.toast(`Caixa ${codigo} incluída!`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    });
  }

  async function transferirEstante(estanteId) {
    if (!edArq.sala) return;
    const est = edArq.estantes.find(e => String(e.id) === String(estanteId));
    if (!est) return;
    const destino = salasCache.filter(s => String(s.id) !== String(edArq.sala.id));
    if (!destino.length) {
      U.toast('Não há outra sala cadastrada para receber a estante.', 'warning');
      return;
    }
    const prats = edArq.prateleiras.filter(p => String(p.estante_id) === String(est.id)).length;
    const cxs = edArq.caixas.filter(c => String(c.estante_id) === String(est.id)).length;

    Modal.open(`Transferir estante ${est.codigo}`, `
      <form class="form-stack" onsubmit="return false">
        <p class="ed-aviso">Move a estante com ${prats} prateleira(s) e ${cxs} caixa(s).
          A estante e as caixas recebem códigos novos na sala de destino
          (o código é único dentro da sala).</p>
        <div class="form-group">
          <label for="edf-dest-sala">Sala de destino *</label>
          <select id="edf-dest-sala">${opcoesDestino(destino, 'Selecione a sala…')}</select>
        </div>
      </form>`, botoesModal('Transferir'));

    ligaBotoesModal('Transferir', async () => {
      const salaId = document.getElementById('edf-dest-sala').value;
      if (!salaId) { U.toast('Selecione a sala de destino.', 'warning'); return; }
      const r = await SGA_API.transferirEstante(est.id, salaId);
      Modal.close();
      U.toast(`Estante ${r.codigo_anterior} → ${r.codigo_novo} `
        + `(${r.caixas} caixa(s) renumeradas).`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    });
  }

  async function transferirCaixa(caixaId) {
    if (!edArq.sala) return;
    const cx = edArq.caixas.find(c => String(c.id) === String(caixaId));
    if (!cx) return;
    const destino = salasCache.filter(s => String(s.id) !== String(edArq.sala.id));
    if (!destino.length) {
      U.toast('Não há outra sala cadastrada para receber a caixa.', 'warning');
      return;
    }
    const docs = edArq.docs[cx.id] || 0;

    Modal.open(`Transferir caixa ${cx.codigo}`, `
      <form class="form-stack" onsubmit="return false">
        <p class="ed-aviso">Move a caixa com ${docs} documento(s) guardado(s).
          A caixa recebe código novo na sala de destino.</p>
        <div class="form-group">
          <label for="edf-cx-sala">Sala de destino *</label>
          <select id="edf-cx-sala">${opcoesDestino(destino, 'Selecione a sala…')}</select>
        </div>
        <div class="form-group">
          <label for="edf-cx-estante">Estante de destino *</label>
          <select id="edf-cx-estante" disabled><option value="">Selecione a sala…</option></select>
        </div>
        <div class="form-group">
          <label for="edf-cx-prateleira">Prateleira de destino *</label>
          <select id="edf-cx-prateleira" disabled><option value="">Selecione a estante…</option></select>
        </div>
      </form>`, botoesModal('Transferir'));

    const selSala = document.getElementById('edf-cx-sala');
    const selEst = document.getElementById('edf-cx-estante');
    const selPrat = document.getElementById('edf-cx-prateleira');

    selSala.addEventListener('change', async () => {
      const salaId = selSala.value;
      selEst.innerHTML = '<option value="">Selecione a estante…</option>';
      selPrat.innerHTML = '<option value="">Selecione a prateleira…</option>';
      selPrat.disabled = true;
      if (!salaId) { selEst.disabled = true; return; }
      selEst.disabled = false;
      selEst.innerHTML = '<option value="">Carregando…</option>';
      try {
        const ests = await SGA_API.listTudo('estantes',
          `&sala_id=eq.${encodeURIComponent(salaId)}&order=codigo`, 'id,codigo');
        if (selSala.value !== salaId) return;
        selEst.innerHTML = opcoesDestino(ests, 'Selecione a estante…');
      } catch {
        selEst.innerHTML = '<option value="">Erro ao carregar estantes</option>';
      }
    });

    selEst.addEventListener('change', async () => {
      const estId = selEst.value;
      selPrat.innerHTML = '<option value="">Selecione a prateleira…</option>';
      if (!estId) { selPrat.disabled = true; return; }
      selPrat.disabled = false;
      selPrat.innerHTML = '<option value="">Carregando…</option>';
      try {
        const prats = await SGA_API.listTudo('prateleiras',
          `&estante_id=eq.${encodeURIComponent(estId)}&order=codigo`, 'id,codigo');
        if (selEst.value !== estId) return;
        selPrat.innerHTML = opcoesDestino(prats, 'Selecione a prateleira…');
      } catch {
        selPrat.innerHTML = '<option value="">Erro ao carregar prateleiras</option>';
      }
    });

    ligaBotoesModal('Transferir', async () => {
      const salaId = selSala.value;
      const estId = selEst.value;
      const pratId = selPrat.value;
      if (!salaId) { U.toast('Selecione a sala de destino.', 'warning'); return; }
      if (!estId) { U.toast('Selecione a estante de destino.', 'warning'); return; }
      if (!pratId) { U.toast('Selecione a prateleira de destino.', 'warning'); return; }
      const r = await SGA_API.transferirCaixa(cx.id, salaId, estId, pratId);
      Modal.close();
      U.toast(`Caixa ${r.codigo_anterior} → ${r.codigo_novo} `
        + `(${r.documentos} documento(s) junto).`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    });
  }

  /** Documentos guardados nas caixas de um nível da árvore. */
  function docsDo(caixas) {
    return (caixas || []).reduce((soma, c) => soma + (edArq.docs[c.id] || 0), 0);
  }

  async function removerEstante(estanteId) {
    const est = edArq.estantes.find(e => String(e.id) === String(estanteId));
    if (!est) return;
    const prats = edArq.prateleiras.filter(p => String(p.estante_id) === String(est.id));
    const cxs = edArq.caixas.filter(c => String(c.estante_id) === String(est.id));
    const docs = docsDo(cxs);
    if (docs > 0) {
      U.toast(`A estante ${est.codigo} tem ${docs} documento(s) arquivado(s). `
        + 'Transfira as caixas antes de remover a estante.', 'error');
      return;
    }
    if (!confirm(`Remover a estante ${est.codigo} e, em cascata, `
      + `${prats.length} prateleira(s) e ${cxs.length} caixa(s)?`)) return;
    try {
      const r = await SGA_API.removerEstante(est.id);
      U.toast(`Estante ${r.codigo} removida (${r.caixas} caixa(s) em cascata).`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    } catch (err) { U.toast(err.message, 'error'); }
  }

  async function removerPrateleira(prateleiraId) {
    const prat = edArq.prateleiras.find(p => String(p.id) === String(prateleiraId));
    if (!prat) return;
    const cxs = edArq.caixas.filter(c => String(c.prateleira_id) === String(prat.id));
    const docs = docsDo(cxs);
    if (docs > 0) {
      U.toast(`A prateleira ${prat.codigo} tem ${docs} documento(s) arquivado(s). `
        + 'Transfira as caixas antes de remover a prateleira.', 'error');
      return;
    }
    if (!confirm(`Remover a prateleira ${prat.codigo} e, em cascata, `
      + `${cxs.length} caixa(s)?`)) return;
    try {
      const r = await SGA_API.removerPrateleira(prat.id);
      U.toast(`Prateleira ${r.codigo} removida (${r.caixas} caixa(s) em cascata).`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    } catch (err) { U.toast(err.message, 'error'); }
  }

  async function removerCaixa(caixaId) {
    const cx = edArq.caixas.find(c => String(c.id) === String(caixaId));
    if (!cx) return;
    const docs = edArq.docs[cx.id] || 0;
    if (docs > 0) {
      U.toast(`A caixa ${cx.codigo} tem ${docs} documento(s) arquivado(s). `
        + 'Transfira ou remova os documentos antes.', 'error');
      return;
    }
    if (!confirm(`Remover a caixa ${cx.codigo}?`)) return;
    try {
      await SGA_API.removerCaixa(cx.id);
      U.toast(`Caixa ${cx.codigo} removida.`, 'success');
      loadLocalSelects();
      await carregarEstruturaSala();
    } catch (err) { U.toast(err.message, 'error'); }
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

  /**
   * Cadastro de Documentos: a partir da SALA escolhida, aloca
   * automaticamente a 1ª caixa livre da sala (ordem de código),
   * onde "livre" = quantidade de documentos < capacidade (pastas).
   */
  async function alocarCaixaPorSala() {
    const selSala = document.getElementById('doc-sala');
    const hid = document.getElementById('doc-caixa');
    const info = document.getElementById('doc-caixa-info');
    if (!selSala || !hid) return;
    const salaId = selSala.value;
    hid.value = '';
    if (info) info.textContent = 'Caixa alocada: —';
    if (!salaId) return;
    try {
      const caixas = await SGA_API.listTudo(
        'caixas', `&sala_id=eq.${encodeURIComponent(salaId)}&order=codigo`,
        'id,codigo,capacidade,sala:salas(codigo),estante:estantes(codigo),prateleira:prateleiras(codigo)');
      const conta = await contarDocumentosPorCaixa();
      const livre = (caixas || []).find(c => {
        const cap = c.capacidade === null || c.capacidade === ''
          ? Infinity : Number(c.capacidade);
        return (conta[c.id] || 0) < cap;
      });
      if (!livre) {
        if (info) info.textContent = 'Nenhuma caixa livre nesta sala.';
        return;
      }
      hid.value = livre.id;
      const ocup = conta[livre.id] || 0;
      const cap = livre.capacidade === null || livre.capacidade === ''
        ? '—' : Number(livre.capacidade);
      if (info) info.textContent = `Caixa alocada: ${U.locLabel(livre)} — ${ocup}/${cap} pastas`;
    } catch (err) {
      if (info) info.textContent = 'Erro ao alocar a caixa.';
      console.warn('alocarCaixaPorSala:', err.message);
    }
  }

  /** Quantidade de documentos por caixa ({ caixa_id: n }). */
  async function contarDocumentosPorCaixa() {
    try {
      const docs = await SGA_API.listTudo('documentos', '', 'caixa_id');
      const conta = {};
      (docs || []).forEach(d => {
        if (d.caixa_id) conta[d.caixa_id] = (conta[d.caixa_id] || 0) + 1;
      });
      return conta;
    } catch {
      return {};
    }
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
