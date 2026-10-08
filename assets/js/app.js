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
  const VERSAO_APP = '20261008.12';

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
    /**
     * Abre o modal. `cls` (opcional) é uma classe extra no
     * overlay — ex.: 'sobre-mapa', que joga o modal por cima do
     * pop-up do mapa (z-index maior) e o alarga para a tabela
     * das pastas caber.
     */
    open(title, bodyHtml, footerHtml, cls) {
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').innerHTML = bodyHtml;
      const footer = document.getElementById('modal-footer');
      footer.innerHTML = footerHtml || '<button class="btn btn-ghost" id="modal-btn-close">Fechar</button>';
      // rebind do botão padrão (footer recriado)
      const btn = document.getElementById('modal-btn-close');
      if (btn) btn.addEventListener('click', () => this.close());
      this.overlay.className = 'modal-overlay' + (cls ? ` ${cls}` : '');
      this.overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    },
    close() {
      if (!this.overlay) return;
      this.overlay.hidden = true;
      this.overlay.className = 'modal-overlay';  // tira classes extras
      // Se o modal estava por cima do MAPA, a rolagem continua
      // travada enquanto o pop-up do mapa seguir aberto.
      const mapa = document.getElementById('mapa-popup');
      document.body.style.overflow = (mapa && !mapa.hidden) ? 'hidden' : '';
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
      case 'pesquisa':
        initPesquisaOnce();
        // O select de sala nasce vazio e quem o preenche é
        // loadLocalSelects() — até aqui ele só rodava na abertura
        // do Cadastro, então uma sessão que ia direto para a
        // Pesquisa ficava sem nenhuma sala para escolher.
        loadLocalSelects();
        break;
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

  /**
   * Desenha o anel de progresso de um card de métrica.
   * `pct` em 0..100 (pode passar de 100 na ocupação: o arco é
   * saturado em 100, mas o texto mostra o valor real). Sem
   * percentual (null/undefined) o anel fica oculto.
   */
  function desenharAnelMetrica(id, pct) {
    const alvo = document.getElementById(id);
    if (!alvo) return;
    if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) {
      alvo.hidden = true;
      alvo.innerHTML = '';
      return;
    }
    const valor = Math.round(Number(pct));
    const cheio = Math.max(0, Math.min(100, valor));
    const R = 30;                       // r=30 em viewBox 72x72
    const C = 2 * Math.PI * R;          // circunferência total
    const avanco = (C * cheio) / 100;
    alvo.innerHTML = `
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle class="metric-ring-trilha" cx="36" cy="36" r="${R}"></circle>
        <circle class="metric-ring-prog" cx="36" cy="36" r="${R}"
                stroke-dasharray="${avanco.toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg>
      <span class="metric-ring-valor">${valor}%</span>`;
    alvo.setAttribute('role', 'img');
    alvo.setAttribute('aria-label', `${valor}%`);
    alvo.hidden = false;
  }

  /**
   * Zera os 4 cards de métrica: é o estado de quem acabou de
   * entrar no Painel (nenhuma sala escolhida) e também o de quem
   * limpou a escolha. "0" sem anel — sem sala não há o que medir.
   */
  function zerarMetricasPainel() {
    ['metric-total', 'metric-emprestados', 'metric-atrasados', 'metric-descarte']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '0';
      });
    ['ring-total', 'ring-emprestados', 'ring-atrasados', 'ring-descarte']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.hidden = true; el.innerHTML = ''; }
      });
  }

  /** Preenche os 4 cards + anéis com as métricas recebidas. */
  function preencheMetricasPainel(m) {
    document.getElementById('metric-total').textContent = m.total;
    document.getElementById('metric-emprestados').textContent = m.emprestados;
    document.getElementById('metric-atrasados').textContent = m.atrasados;
    document.getElementById('metric-descarte').textContent = m.paraDescarte;

    // Anéis de progresso (modelo do card): cada % é um derivado
    // dos números acima — ocupação da sala, empréstimos sobre o
    // acervo da sala, atrasados sobre os empréstimos e descarte
    // sobre o acervo. Sem denominador não há o que medir: anel oculto.
    desenharAnelMetrica('ring-total', m.ocupacao && m.ocupacao.percentual);
    desenharAnelMetrica('ring-emprestados',
      m.total > 0 ? Math.round((m.emprestados / m.total) * 100) : null);
    desenharAnelMetrica('ring-atrasados',
      m.emprestados > 0 ? Math.round((m.atrasados / m.emprestados) * 100) : null);
    desenharAnelMetrica('ring-descarte',
      m.total > 0 ? Math.round((m.paraDescarte / m.total) * 100) : null);
  }

  /**
   * Cards da sala escolhida. Sem sala (ou escolha vazia) volta ao
   * zero; com sala, busca os números recortados. O mesmo guarda da
   * sala nova vale aqui: uma troca rápida não pode deixar o
   * resultado velho pintar no lugar da sala nova.
   */
  async function loadMetricasSala(salaId) {
    if (!salaId) { zerarMetricasPainel(); return; }
    const m = await SGA_API.getMetricas(salaId);
    const sel = document.getElementById('mapa-sala');
    if (sel && String(sel.value) !== String(salaId)) return;
    preencheMetricasPainel(m);
  }

  function loadPainel() {
    // Cards: entram ZERADOS (sem anéis) até uma sala ser escolhida
    // na barra do Mapa do Arquivo — a escolha é quem chama
    // loadMetricasSala(). As duas tabelas resumo (últimos documentos
    // e empréstimos ativos) foram removidas do Painel.
    zerarMetricasPainel();

    // Gráficos: entram zerados e só carregam quando a sala for
    // escolhida na barra do Mapa do Arquivo. A escolha anterior
    // também é limpa: deixar o select nomeando uma sala com os
    // gráficos zerados seria mentiroso.
    const selSala = document.getElementById('mapa-sala');
    if (selSala) selSala.value = '';
    zerarGraficosPainel();

    // Mapa do arquivo (select de sala + grade de caixas)
    initMapaArquivo().catch(err => console.warn('mapa do arquivo:', err.message));
  }

  /* ============================================================
     GRÁFICOS DO PAINEL (SVG puro, sem biblioteca externa)

     1) VELOCÍMETRO da ocupação do arquivo: medidor segmentado de
        270° com abertura para baixo, 7 blocos do verde escuro ao
        vermelho, agulha no valor atual e o total de pastas
        ocupadas sobre a capacidade.
   2) LINHAS DA MOVIMENTAÇÃO dia a dia: um ano de dias (365 pontos)
      com três séries — novos, para descarte (prazo de guarda
      vencido) e empréstimos atrasados —, eixo Y em escala
      "redondada" e rótulos DIÁRIOS (dd/mm) no eixo X, com o dia de
      hoje destacado no fim (os 365 dias não cabem, então afunilam
      de trás para frente).

      Ambos são desenhados em SVG com viewBox: escalam com a largura
      do painel sem depender de <canvas> nem de CDN (a CSP do
      projeto bloqueia script externo).
      ============================================================ */

  /**
   * Escala do eixo Y: teto "redondo" acima do maior valor.
   *
   * O passo (teto / 4) é que vem arredondado: assim as 5 linhas da
   * grade caem em números legíveis (3, 6, 9, 12 em vez de 5, 10,
   * 15, 20 para o máximo 12 — sobrava 66% de altura vazia).
   */
  function tetoEixo(maximo) {
    if (!(maximo > 0)) return 4;
    const bruto = maximo / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(bruto)));
    const n = bruto / magnitude;
    const passo = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2
      : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4
      : n <= 5 ? 5 : n <= 7.5 ? 7.5 : 10;
    return passo * magnitude * 4;
  }

  /** Número curto no eixo: 1.2 mil em vez de 1200. */
  function numeroEixo(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} mil` : String(n);
  }

  /**
   * Desenha o velocímetro de ocupação.
   * `ocupacao` = { ocupadas, capacidade, percentual, caixas }.
   *
   * Estilo do "medidor segmentado" (imagem de referência): arco de
   * 270° com a abertura para baixo, dividido em 7 segmentos com
   * folga entre eles, do verde escuro ao vermelho, agulha esbelta e
   * pivô grande. O valor fica em texto ABAIXO do pivô — o centro é
   * ocupado pela agulha.
   */
  function renderVelocimetro(ocupacao) {
    const box = document.getElementById('velocimetro');
    if (!box) return;
    const { ocupadas, capacidade, percentual } = ocupacao;

    // Sem capacidade cadastrada não há o que medir: mostra o
    // aviso em vez de um velocímetro mentiroso (0%).
    if (!(capacidade > 0)) {
      box.innerHTML =
        '<p class="empty-state">Sem capacidade cadastrada nas caixas — '
        + 'defina a capacidade de arquivamento para medir a ocupação.</p>';
      return;
    }

    // Acima de 100% (documento em caixa cheia) o arco satura em 100.
    const pct = Math.max(0, Math.min(100, percentual));
    const CX = 130, CY = 104, RAIO = 86, ESPESSURA = 26;
    const EIXO = RAIO - ESPESSURA / 2;   // raio médio da faixa
    // Arco de 270°: começa em 225° (abaixo-esquerda) e termina em
    // -45° (abaixo-direita); a abertura fica virada para baixo.
    const A_INI = 225, A_FIM = -45;
    const CORES = [
      '#15803d', '#16a34a', '#65a30d', '#eab308',
      '#f59e0b', '#ea580c', '#dc2626',
    ];
    const FOLGA = 5;    // graus em branco entre um segmento e outro
    const passo = (A_INI - A_FIM) / CORES.length;
    // 225° = abaixo-esquerda, 90° = topo, 0° = direita. Y do SVG
    // cresce para baixo, por isso o sinal de menos no seno.
    const ponto = (graus, r) => {
      const rad = (graus * Math.PI) / 180;
      return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)];
    };
    /**
     * Arco como POLILINHA de 1 grau por segmento.
     *
     * O comando SVG `A` (arco elíptico) fica ambíguo quando os
     * dois pontos distam menos que o diâmetro: o renderizador pode
     * escolher o outro centro de curvatura e o arco sai pelo lado
     * errado — foi o que aconteceu com as faixas deste gráfico
     * (o verde "comia" parte do amarelo). A polilinha não depende
     * de flag: ela passa exatamente pelos pontos calculados.
     */
    const arco = (a1, a2, r) => {
      const passos = Math.max(1, Math.round(Math.abs(a1 - a2)));
      const d = [];
      for (let i = 0; i <= passos; i++) {
        const [x, y] = ponto(a1 + ((a2 - a1) * i) / passos, r);
        d.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
      return d.join(' ');
    };

    const segmentos = CORES.map((cor, i) => {
      const a1 = A_INI - i * passo - FOLGA / 2;
      const a2 = A_INI - (i + 1) * passo + FOLGA / 2;
      return `<path d="${arco(a1, a2, EIXO)}" fill="none" stroke="${cor}"
                stroke-width="${ESPESSURA}" stroke-linecap="butt"/>`;
    }).join('');

    // Agulha: 0% = 225° e 100% = -45° (curso de 270°). O desenho
    // aponta para cima e a rotação gira em torno do centro do arco.
    const alpha = -135 + 270 * (pct / 100);
    const agulha = `
      <g class="velo-agulha" style="transform:rotate(${alpha.toFixed(2)}deg);
              transform-origin:${CX}px ${CY}px">
        <path d="M ${CX} ${CY - (EIXO - 4)} L ${CX - 6.5} ${CY + 9} L ${CX + 6.5} ${CY + 9} Z"
              fill="#3f454d"/>
      </g>
      <circle cx="${CX}" cy="${CY}" r="13" fill="#4a515b"/>`;

    box.innerHTML = `
      <svg class="velo-svg" viewBox="0 0 260 210" role="img"
           aria-label="Ocupação do arquivo: ${percentual}% (${ocupadas} de ${capacidade} pastas)">
        <title>Ocupação do arquivo: ${percentual}% (${ocupadas} de ${capacidade} pastas)</title>
        ${segmentos}
        ${agulha}
        <text class="velo-valor" x="${CX}" y="${CY + 80}" text-anchor="middle">${percentual}<tspan
              class="velo-simbolo">%</tspan></text>
        <text class="velo-legenda" x="${CX}" y="${CY + 96}" text-anchor="middle">ocupação</text>
        <text class="velo-mini" x="${CX - 82}" y="${CY + 82}" text-anchor="end">0%</text>
        <text class="velo-mini" x="${CX + 82}" y="${CY + 82}" text-anchor="start">100%</text>
      </svg>
      <p class="velo-resumo">
        <strong>${ocupadas}</strong> de ${capacidade} pastas ocupadas
      </p>`;
  }

  /**
   * Desenha o gráfico de LINHAS da movimentação DIA A DIA
   * (novos x para descarte x empréstimos atrasados).
   * `dias` = [{ chave, rotulo, novos, paraDescarte, atrasados }].
   *
   * Estilo do gráfico de referência (imagem anexa): curvas suaves
   * (Catmull-Rom convertido para Béziers cúbicos), traço grosso com
   * ponta redonda e brilho colorido, grade só horizontal, sem linha
   * de eixo e o dia atual destacado em azul no eixo X. O que muda é
   * só o PASSO: um ano de dias no lugar de 12 meses.
   *
   * Rótulos do eixo X: só dias, no formato dd/mm, afunilados de
   * trás para frente — o dia de HOJE fica sempre no eixo (e sai
   * destacado em azul). Marcar os 365 dias poluiria o eixo.
   *
   * O viewBox usa a LARGURA e a ALTURA REAIS do card: no Painel a
   * linha dos gráficos é esticada até o fim da tela e o gráfico
   * preenche o card inteiro (os dois cards fecham com a mesma
   * medida). Largura/altura mudam com a janela, então o resize
   * redesenha (listener no fim da seção).
   */
  const DIAS_GRAFICO = 365;
  let graficoMovimentoDados = [];

  function renderGraficoMovimento(dias) {
    const box = document.getElementById('grafico-movimento');
    if (!box) return;
    const dados = dias || [];
    graficoMovimentoDados = dados;

    const maximo = dados.reduce(
      (m, d) => Math.max(m, d.novos, d.paraDescarte, d.atrasados), 0);

    // Sem movimento nenhum os valores são ZERO, não ausência de dado:
    // o gráfico continua desenhado (eixo, rótulos e curvas zeradas)
    // para o usuário não concluir que a série sumiu.
    if (!dados.length) {
      box.innerHTML = '<p class="empty-state">Sem dias para exibir</p>';
      return;
    }

    // O SVG ocupa o CONTEÚDO do card: clientWidth traz o padding
    // junto, e offsetWidth - clientWidth é exatamente esse padding
    // (px puro, sem depender de a UI devolver rem ou px).
    const util = box.clientWidth - (box.offsetWidth - box.clientWidth);
    const L = 42, R = 14, T = 20, B = 30;   // margens
    // Altura: acompanha o card. No Painel a linha dos gráficos é
    // esticada até o fim da tela (flex: 1 da seção) e o gráfico
    // preenche o conteúdo do card. O clientHeight vem com o padding
    // do .panel-body, então ele é descontado (sem getComputedStyle
    // — ex.: harness em vm — cai no padrão 240, como antes).
    const pad = typeof getComputedStyle === 'function'
      ? (parseFloat(getComputedStyle(box).paddingTop) || 0)
        + (parseFloat(getComputedStyle(box).paddingBottom) || 0)
      : 0;
    const altUtil = box.clientHeight - (box.offsetHeight - box.clientHeight) - pad;
    const H = altUtil > 100 ? Math.round(altUtil) : 240;
    const W = util > 240 ? util : 720;       // card escondido: escala pelo CSS
    const larguraPlot = W - L - R;
    const alturaPlot = H - T - B;
    const teto = tetoEixo(maximo);
    const y = v => T + alturaPlot - (v / teto) * alturaPlot;

    // Grade + rótulos do eixo Y
    const passos = 4;
    const grade = Array.from({ length: passos + 1 }, (_, i) => {
      const v = (teto / passos) * i;
      const py = y(v).toFixed(1);
      return `<line class="grafico-grade" x1="${L}" y1="${py}" x2="${W - R}" y2="${py}"/>`
        + `<text class="grafico-eixo-y" x="${L - 8}" y="${py}" text-anchor="end" dy=".32em">${numeroEixo(v)}</text>`;
    }).join('');

    const banda = larguraPlot / dados.length;
    const centro = i => L + banda * (i + 0.5);
    const base = T + alturaPlot;

    /**
     * Curva suave passando por TODOS os pontos: Catmull-Rom
     * (p1,p2) -> Bézier cúbica com controles em 1/6 do trecho.
     * Os controles de Y são cortados aos limites do plot para a
     * curva não sair por cima/baixo da área do gráfico.
     */
    const curva = pts => {
      if (pts.length < 2) return '';
      const corte = v => Math.max(T, Math.min(base, v));
      let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = corte(p1[1] + (p2[1] - p0[1]) / 6);
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = corte(p2[1] - (p3[1] - p1[1]) / 6);
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}`
          + ` ${c2x.toFixed(1)} ${c2y.toFixed(1)}`
          + ` ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
      }
      return d;
    };

    // Uma série = curva. O tooltip é uma ÁREA INVISÍVEL POR DIA
    // (365 círculos de 9px sobrepostos não deixariam pegar o dia
    // certo): o <title> do retângulo abre no mouse, com as três
    // leituras daquele dia.
    const serie = (campo, classe) => {
      const pts = dados.map((d, i) => [centro(i), y(d[campo])]);
      return `<path class="grafico-linha ${classe}" d="${curva(pts)}"/>`;
    };

    const alvos = dados.map((d, i) =>
      `<rect class="grafico-ponto" x="${(L + banda * i).toFixed(1)}" y="${T}"`
      + ` width="${Math.max(1, banda).toFixed(1)}" height="${alturaPlot}">`
      + `<title>${U.esc(d.rotulo)} — novos ${d.novos},`
      + ` para descarte ${d.paraDescarte},`
      + ` empréstimos atrasados ${d.atrasados}</title></rect>`).join('');

    // Rótulos do eixo X: SÓ DIAS (dd/mm) — nada de mês no eixo.
    // 365 dias não cabem, então afunila CONTANDO DO FIM: o dia de
    // HOJE (o último) entra sempre e os demais caem a cada `passo`
    // dias, o que mantém o espaçamento mínimo de 56px entre
    // rótulos — e é o único jeito de o de hoje nunca cair fora.
    const ultimo = dados.length - 1;
    const passo = Math.max(1, Math.ceil(dados.length
      / Math.max(2, Math.floor(larguraPlot / 56))));
    const partes = [];
    for (let i = ultimo; i >= 0; i -= passo) {
      const atual = i === ultimo ? ' atual' : '';
      partes.unshift(
        `<text class="grafico-eixo-x${atual}" x="${centro(i).toFixed(1)}"`
        + ` y="${base + 16}" text-anchor="middle">${U.esc(dados[i].rotulo)}</text>`);
    }
    const rotulos = partes.join('');

    const titulo = 'Movimentação da sala de arquivo, dia a dia '
      + `(últimos ${dados.length} dias)`;
    box.innerHTML = `
      <svg class="grafico-svg" viewBox="0 0 ${W} ${H}" role="img"
           aria-label="${titulo}">
        <title>${titulo}</title>
        ${grade}
        ${serie('novos', 'c-novos')}
        ${serie('paraDescarte', 'c-paradescarte')}
        ${serie('atrasados', 'c-atrasados')}
        ${alvos}
        ${rotulos}
      </svg>`;
  }

  /** Carrega e desenha os dois gráficos do painel para UMA sala. */
  async function loadGraficosPainel(salaId) {
    if (!salaId) {
      zerarGraficosPainel();
      return;
    }
    const g = await SGA_API.getGraficosPainel(DIAS_GRAFICO, salaId);
    // A sala pode ter sido trocada enquanto o fetch estava no ar:
    // o resultado velho não pode pintar no lugar da sala nova.
    const sel = document.getElementById('mapa-sala');
    if (sel && String(sel.value) !== String(salaId)) return;
    renderVelocimetro(g.ocupacao || {});
    renderGraficoMovimento(g.dias || []);
  }

  /**
   * Estado inicial do Painel: gráficos SEM INFORMAÇÃO, porque
   * nenhum deles faz sentido antes de escolher a sala — a ocupação
   * e as séries são por sala, e o total do acervo inteiro é outra
   * leitura (que a tela não mostra).
   *
   * O gráfico diário sai com o ano inteiro em zero de verdade (eixo,
   * rótulos e curvas zeradas), que é o que o usuário pediu. Já o
   * velocímetro NÃO vira 0%: sem sala não há capacidade conhecida,
   * e 0% ali seria um número inventado (mesma razão do aviso de
   * "sem capacidade cadastrada" lá embaixo). Fica o recado.
   */
  function zerarGraficosPainel() {
    const velo = document.getElementById('velocimetro');
    if (velo) {
      velo.innerHTML =
        '<p class="empty-state">Selecione uma sala no Mapa do Arquivo '
        + 'para ver a ocupação dela.</p>';
    }
    renderGraficoMovimento(semDadosDiarios(DIAS_GRAFICO));
  }

  /**
   * Um ano em zero para o estado sem sala. Os rótulos saem dos
   * MESMOS helpers do api.js, senão o eixo X trocaria de formato
   * no instante em que a sala fosse escolhida.
   */
  function semDadosDiarios(n) {
    return SGA_API.ultimosDias(n)
      .map(d => ({ ...d, novos: 0, paraDescarte: 0, atrasados: 0 }));
  }

  /**
   * O viewBox do gráfico diário acompanha largura E altura do card:
   * ao redimensionar a janela ele é redesenhado (o flex do Painel
   * redistribui os cards, então os dois fecham com a mesma medida).
   */
  let timerResizeGrafico = null;
  window.addEventListener('resize', () => {
    clearTimeout(timerResizeGrafico);
    timerResizeGrafico = setTimeout(() => {
      if (graficoMovimentoDados.length) renderGraficoMovimento(graficoMovimentoDados);
    }, 150);
  });

  /* ============================================================
     MAPA DO ARQUIVO (painel): select de sala + planta da sala.
     A planta é um GRID ÚNICO de estantes: um QUADRADO por
     estante (rótulo da estante fora do quadrado) e, dentro,
     a grade uniforme das caixas da estante — verde = vazia,
     amarela = parcial, cinza = cheia, vermelha = cheia toda p/
     descarte, ✓ vermelho onde só ALGUMAS pastas são p/ descarte;
     clique na caixa abre o conteúdo (pastas/documentos e status);
     a descrição da caixa fica no tooltip do mouse.
     ============================================================ */
  let mapaInit = false;
  let mapaSeq = 0;
  let mapaSalas = [];
  /** Caixas/estantes da sala aberta no pop-up (id -> objeto). */
  let mapaCaixas = new Map();
  let mapaEstantes = new Map();
  /** Nº de aberturas do modal de conteúdo de caixa (evita resposta velha). */
  let mapaCaixaSeq = 0;

  /**
   * Preenche o select de salas do Painel.
   *
   * Escolher a sala carrega a SALA e os GRÁFICOS dela: a planta
   * continua abrindo pelo botão "Ver mapa" (decisão mantida), mas
   * ocupação e movimentação (dia a dia) passam a ser daquela sala.
   *
   * Os gráficos entram zerados ao abrir a seção, então a 1ª escolha
   * também é quem "liga" o painel — não há leitura do acervo inteiro.
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
        carregaGraficosDaSala(sel.value);
      });
      window.addEventListener('resize', encaixaMapa);
      document.getElementById('mapa-abrir')?.addEventListener('click', abreMapa);
      document.getElementById('mapa-popup-fechar')?.addEventListener('click', fechaMapa);
      const popup = document.getElementById('mapa-popup');
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        // Modal aberto por cima do mapa (conteúdo da caixa):
        // o Escape fecha SÓ o modal; o mapa fecha no próximo.
        const modal = document.getElementById('modal-overlay');
        if (modal && !modal.hidden) return;
        if (popup && !popup.hidden) fechaMapa();
      });
      // Clique numa caixa do mapa -> lista as pastas/documentos
      // dela (delegação: os quadrados são recriados a cada sala).
      document.getElementById('mapa-estantes')?.addEventListener('click', ev => {
        const quad = ev.target.closest('.mapa-quad');
        if (quad && quad.dataset.caixa) abrirConteudoCaixa(quad.dataset.caixa);
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
    Modal.close();  // fecha também o conteúdo da caixa, se aberto
    document.body.style.overflow = '';
  }

  /** Botão "Ver mapa" só faz sentido com uma sala escolhida. */
  function atualizaBotaoMapa() {
    const sel = document.getElementById('mapa-sala');
    const btn = document.getElementById('mapa-abrir');
    if (btn) btn.disabled = !sel || !sel.value;
  }

  /**
   * Sala escolhida -> gráficos E cards de métrica daquela sala.
   * Sem sala (ou com escolha vazia) volta tudo ao estado zerado.
   * Erro de rede não pode virar tela quebrada: avisa no console e
   * mantém o anterior.
   */
  function carregaGraficosDaSala(salaId) {
    return Promise.all([
      loadGraficosPainel(salaId || null),
      loadMetricasSala(salaId || null),
    ]).catch(err => console.warn('painel da sala:', err.message));
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
        resumoPastasPorCaixa(),
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
   * da estante (cor por ocupação E por descarte, ver regras em
   * quadradinho(); clique na caixa abre o conteúdo dela e a
   * descrição fica no tooltip do mouse). O
   * resultado é medido e reduzido (scale) por encaixaMapa() para
   * caber no pop-up, sem barra de rolagem.
   *
   * `conta` = { total, descarte } de resumoPastasPorCaixa():
   * pastas ativas e destas quantas estão para descarte.
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

    // Guarda a sala aberta: o clique no quadrado usa estes mapas
    // para abrir o conteúdo da caixa (abrirConteudoCaixa).
    mapaEstantes = new Map((estantes || []).map(e => [String(e.id), e]));
    mapaCaixas = new Map((caixas || []).map(c => [String(c.id), c]));

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
    // estante): docsSala = pastas ativas arquivadas (descartadas
    // não contam); capSala = pastas que as caixas da sala
    // comportam (caixa.capacidade). O "% de ocupação" da barra
    // sai da razão entre os dois.
    let vazias = 0, parciais = 0, cheias = 0, mistas = 0, todasDescarte = 0;
    let docsSala = 0, capSala = 0;

    /**
     * Cor da caixa (seis estados — 4 cores + 2 com marca):
     *   vazia   = nenhuma pasta ativa                  -> verde
     *   parcial = ocupação parcial, sem descarte       -> amarela
     *   cheia   = 100%, sem descarte                   -> cinza claro
     *   descarte= CHEIA e TODAS as pastas p/ descarte  -> vermelha
     *             (sem marca: a cor já é o sinal)
     *   parcial + alguma p/ descarte -> amarela + ✓ vermelho
     *   misto   = cheia com alguma (não todas) p/ descarte
     *                                  -> cinza claro + ✓ vermelho
     * A marca de confirmação ✓ vermelho no centro é .tem-descarte
     * e só aparece quando HÁ pasta para descarte na caixa.
     */
    const quadradinho = c => {
      const docs = (conta.total && conta.total[c.id]) || 0;
      const desc = Math.min(docs, (conta.descarte && conta.descarte[c.id]) || 0);
      const cap = vazio(c.capacidade) ? null : Number(c.capacidade);
      let pct = null;
      if (cap) {
        pct = Math.min(100, Math.round((docs / cap) * 100));
        capSala += cap;
      }
      docsSala += docs;
      let classe = (pct === 0 || (pct === null && docs === 0)) ? 'vazio'
        : (pct !== null && pct >= 100 ? 'cheia' : 'parcial');
      let marca = false;
      if (docs > 0 && desc === docs && classe === 'cheia') {
        classe = 'descarte';
      } else if (desc > 0) {
        marca = true;
        if (classe === 'cheia') classe = 'misto';
      }
      if (classe === 'vazio') vazias++;
      else if (classe === 'parcial') parciais++;
      else if (classe === 'cheia') cheias++;
      else if (classe === 'misto') mistas++;
      else todasDescarte++;
      const nome = c.descricao || c.codigo || '—';
      const ocup = cap ? `${docs}/${cap}` : `${docs}`;
      const titulo = docs
        ? `${nome} — ${ocup} pastas${desc ? ` · ${desc} para descarte` : ''} · clique para ver as pastas`
        : `${nome} · clique para ver as pastas`;
      return `<div class="mapa-quad ${classe}${marca ? ' tem-descarte' : ''}"` +
        ` data-caixa="${U.esc(c.id)}" title="${U.esc(titulo)}"></div>`;
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
      // Casas livres da grade (linha x coluna da sala sem estante):
      // é o que permite desenhar o traço cinza claro da estrutura
      // da sala. `livres` (e não `vazias`) porque o nome `vazias`
      // já é, aqui fora, a CONTAGEM de caixas vazias.
      const livres = [];
      for (let l = 1; l <= linhas; l++) {
        for (let c = 1; c <= colunas; c++) {
          if (!casas.has(`${l}|${c}`)) livres.push({ linha: l, coluna: c });
        }
      }

      return { linhas, colunas, fixas, semEstante: pSem, livres };
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
    // Traço cinza claro nas casas livres da grade: é o que mostra a
    // linha x coluna da sala real onde ainda não há estante. Entra
    // DEPOIS do dataset.blocos para não contar casa vazia como
    // estante (encaixaMapa() dimensiona pelo nº de estantes).
    if (planta && planta.livres.length) {
      planta.livres.forEach(p => blocos.push(
        `<div class="mapa-casa" aria-hidden="true"`
        + ` title="Linha ${p.linha}, coluna ${p.coluna} — sem estante"`
        + ` style="grid-row:${p.linha};grid-column:${p.coluna}"></div>`));
    }

    grid.innerHTML = blocos.join('');

    // Barra de informação da sala: contagens + % de ocupação da
    // SALA = documentos arquivados / capacidade de arquivamento
    // (soma das pastas de todas as caixas da sala).
    const ocupacao = capSala > 0 ? Math.round((docsSala / capSala) * 100) : null;
    resumo.textContent =
      `${estantes.length} estante · ${caixas.length} caixa · ${vazias} vazia · ` +
      `${parciais} parcial · ${cheias} cheia · ${mistas} mista · ` +
      `${todasDescarte} toda para descarte` +
      (ocupacao !== null ? ` · ${ocupacao}% de ocupação` : '');
    resumo.hidden = false;
    encaixaMapa();
  }

  /**
   * Clique numa caixa do MAPA: abre o modal com as pastas/
   * documentos daquela caixa e o status de cada um — mais o prazo
   * de guarda vencido, que é o que coloca a pasta "para
   * descarte" (mesmo critério das cores da caixa).
   *
   * O modal entra com a classe 'sobre-mapa': fica POR CIMA do
   * pop-up do mapa (z-index maior) e mais largo, p/ a tabela
   * caber. fechaMapa() fecha este modal junto com o mapa.
   */
  async function abrirConteudoCaixa(caixaId) {
    const cx = mapaCaixas.get(String(caixaId));
    if (!cx) return;
    const minhaVez = ++mapaCaixaSeq;
    const est = mapaEstantes.get(String(cx.estante_id == null ? '' : cx.estante_id));
    const selSala = document.getElementById('mapa-sala');
    const salaNome = ((selSala && selSala.options[selSala.selectedIndex]) || {}).textContent || '';
    const titulo = cx.descricao ? `Caixa ${cx.codigo} — ${cx.descricao}` : `Caixa ${cx.codigo}`;

    Modal.open(titulo, '<p class="empty-state">Carregando pastas…</p>', undefined, 'sobre-mapa');

    let docs;
    try {
      docs = await SGA_API.listTudo('documentos',
        `&caixa_id=eq.${encodeURIComponent(caixaId)}&order=protocolo`,
        'id,protocolo,descricao,setor,status,prazo_guarda');
    } catch (err) {
      if (minhaVez === mapaCaixaSeq && Modal.overlay && !Modal.overlay.hidden) {
        Modal.open(titulo,
          `<p class="empty-state">Erro ao carregar as pastas: ${U.esc(err.message)}</p>`,
          undefined, 'sobre-mapa');
      }
      return;
    }
    docs = docs || [];
    // Outro clique assumiu, ou o usuário já fechou o modal
    if (minhaVez !== mapaCaixaSeq || !Modal.overlay || Modal.overlay.hidden) return;

    const hoje = U.hoje();
    const ativos = docs.filter(d => d.status !== 'descartado');
    const cap = (cx.capacidade === null || cx.capacidade === undefined || cx.capacidade === '')
      ? null : Number(cx.capacidade);
    const paraDesc = ativos.filter(d => d.prazo_guarda && d.prazo_guarda <= hoje).length;

    const info = [
      ['Localização', U.esc([salaNome, est ? (est.descricao || est.codigo) : 'Sem estante']
        .filter(Boolean).join(' · '))],
      ['Ocupação', `${ativos.length}${cap ? `/${cap}` : ''} pastas`
        + (paraDesc ? ` · <span class="tag-descarte">${paraDesc} para descarte</span>` : '')],
    ].map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    const linhas = docs.map(d => {
      const vencido = d.status !== 'descartado' && d.prazo_guarda && d.prazo_guarda <= hoje;
      return `<tr><td><strong>${U.esc(d.protocolo)}</strong></td>`
        + `<td>${U.esc(d.descricao || '—')}</td>`
        + `<td>${U.esc(d.setor || '—')}</td>`
        + `<td>${U.pill(d.status)}</td>`
        + `<td>${U.fmtData(d.prazo_guarda)}`
        + (vencido ? ' <span class="tag-descarte">p/ descarte</span>' : '')
        + '</td></tr>';
    }).join('');

    const tabela = docs.length
      ? '<div class="table-wrap"><table class="data-table"><thead><tr>'
        + '<th>Protocolo</th><th>Nome</th><th>Setor</th><th>Status</th><th>Prazo guarda</th>'
        + `</tr></thead><tbody>${linhas}</tbody></table></div>`
      : '<p class="empty-state">Caixa sem pastas/documentos</p>';

    Modal.open(titulo, `<dl>${info}</dl>${tabela}`, undefined, 'sobre-mapa');
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

      U.clearErrors(form);
      const dataIni = document.getElementById('pesq-data-ini').value;
      const dataFim = document.getElementById('pesq-data-fim').value;
      // Período invertido: nada sairia do banco — avisa antes de
      // trocar a tabela por "Pesquisando…".
      if (dataIni && dataFim && dataIni > dataFim) {
        U.setError('pesq-data-ini', 'Data inicial maior que a final');
        U.toast('Período inválido: a data inicial é posterior à final.', 'warning');
        return;
      }

      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Pesquisando…</td></tr>';

      try {
        const filtros = {
          protocolo: document.getElementById('pesq-protocolo').value.trim(),
          descricao: document.getElementById('pesq-descricao').value.trim(),
          setor: document.getElementById('pesq-setor').value,
          status: document.getElementById('pesq-status').value,
          salaId: document.getElementById('pesq-sala').value,
          dataIni,
          dataFim,
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

    // Período: escolher a data já refaz a busca (debounce 300ms)
    ['pesq-data-ini', 'pesq-data-fim'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        clearTimeout(timerDescricao);
        timerDescricao = setTimeout(executarPesquisa, 300);
      });
    });

    document.getElementById('btn-limpar-pesquisa').addEventListener('click', () => {
      clearTimeout(timerDescricao);
      seqPesquisa++; // cancela resposta pendente
      paginaPesquisa = 1;
      U.clearErrors(form);
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
        <td class="cell-local">${U.esc(
          d.status === 'descartado' ? '— (fora do acervo)' : U.locLabel(d.caixas)
        )}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-ghost" data-view="${U.esc(d.id)}">Detalhes</button>
            <button class="btn btn-sm btn-ghost" data-editar="${U.esc(d.id)}">Editar</button>
            <button class="btn btn-sm btn-ghost" data-transferir="${U.esc(d.id)}"
              ${d.status === 'descartado' ? 'disabled title="Documento descartado"' : ''}>Transferir</button>
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

    tbody.querySelectorAll('[data-transferir]').forEach(btn => {
      btn.addEventListener('click', () => abrirTransferirPasta({ docId: btn.dataset.transferir }));
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
      ['Localização', U.esc(d.status === 'descartado'
        ? '— (fora do acervo: documento descartado)'
        : U.locLabel(d.caixas))],
      ['Observações', U.esc(d.observacoes || '—')],
    ];
    const html = rows.map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('');

    // "Excluir" somente para administradores
    const isAdmin = (SGA_API.getStoredUser() || {}).perfil === 'admin';
    const descartado = d.status === 'descartado';
    const footer = '<button class="btn btn-primary" id="btn-transferir-doc"'
      + `${descartado ? ' disabled title="Documento descartado"' : ''}>Transferir</button>`
      + (isAdmin
        ? '<button class="btn btn-danger" id="btn-excluir-doc">Excluir</button>'
        : '')
      + '<button class="btn btn-ghost" id="modal-btn-close">Fechar</button>';

    Modal.open(`Documento ${d.protocolo}`, `<dl>${html}</dl>`, footer);

    const btnTransferir = document.getElementById('btn-transferir-doc');
    if (btnTransferir && !descartado) {
      btnTransferir.addEventListener('click', () => abrirTransferirPasta({ docId: d.id }));
    }
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
    // opções de tipo/setor/categoria reutilizadas do formulário de cadastro
    const elTipo = document.getElementById('doc-tipo');
    const elSetor = document.getElementById('doc-setor');
    const elCategoria = document.getElementById('doc-categoria');
    const opsTipo = elTipo ? elTipo.innerHTML : '';
    const opsSetor = elSetor ? elSetor.innerHTML : '';
    const opsCategoria = elCategoria ? elCategoria.innerHTML : '';

    const [caixas, conta] = await Promise.all([
      carregarCaixasCompletas(),
      contarDocumentosPorCaixa(),
    ]);
    if (!caixas) {
      U.toast('Erro ao carregar as caixas. Tente novamente.', 'error');
      return;
    }
    // o codigo da caixa e unico DENTRO da sala, mas se repete em
    // outra sala: sala + prateleira desambiguam a opcao.
    // Caixa sem vaga fica desabilitada (a pasta dela não cabe mais);
    // a caixa ATUAL do documento continua selecionável para quem
    // só quer editar os outros campos sem mover a pasta.
    const caixaAtual = String(d.caixa_id || '');
    // Descartado não guarda em caixa nenhuma (sql/19): o campo de
    // localização fica travado avisando isso, em vez de exigir uma
    // caixa que ele não pode voltar a ocupar.
    const descartado = d.status === 'descartado';
    const opsCaixa = (caixas || [])
      .map(c => {
        const loc = [c.sala?.codigo, c.prateleira?.codigo].filter(Boolean).join(' / ');
        const cap = capacidadeDaCaixa(c);
        const ocup = conta[c.id] || 0;
        const cheia = ocup >= cap;
        const ehAtual = String(c.id) === caixaAtual;
        const marca = cheia
          ? (ehAtual ? ` (${ocup}/${cap}) · atual` : ` (${ocup}/${cap}) · CHEIA`)
          : ` (${ocup}/${cap})`;
        const rotulo = `${c.codigo}${loc ? ' (' + loc + ')' : ''}`
          + `${c.descricao ? ' — ' + c.descricao : ''}${marca}`;
        return `<option value="${U.esc(c.id)}"${cheia && !ehAtual ? ' disabled' : ''}>${U.esc(rotulo)}</option>`;
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
          <select id="ed-tipo">${opsTipo}</select>
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
          <label for="ed-caixa">Caixa / Localização Física${descartado ? '' : ' *'}</label>
          <select id="ed-caixa"${descartado ? ' disabled' : ''}>${
            descartado
              ? '<option value="">Sem caixa — documento descartado</option>'
              : `<option value="">Selecione…</option>${opsCaixa}`
          }</select>
          <span class="field-error" id="error-ed-caixa" role="alert"></span>
          ${descartado
            ? '<span class="ed-meta">Documento descartado: ele já saiu da caixa '
              + 'e da sala do arquivo; só o histórico permanece.</span>'
            : ''}
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
    // tipos antigos cadastrados com texto livre podem não estar na lista
    const selTipo = document.getElementById('ed-tipo');
    if (d.tipo && ![...selTipo.options].some(o => o.value === d.tipo)) {
      selTipo.add(new Option(d.tipo, d.tipo));
    }
    selTipo.value = d.tipo || '';
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
      if (!tipo) { U.setError('ed-tipo', 'Selecione o tipo.'); ok = false; }
      if (!setor) { U.setError('ed-setor', 'Selecione o setor.'); ok = false; }
      if (!categoria) { U.setError('ed-categoria', 'Selecione a categoria.'); ok = false; }
      if (!dataDoc) { U.setError('ed-data', 'Informe a data do documento.'); ok = false; }
      if (!prazo) { U.setError('ed-prazo', 'Informe o prazo de guarda.'); ok = false; }
      // Descartado não volta para caixa: o campo está travado e o
      // caixa_id continua NULL (o banco reforça isso no trigger).
      if (!caixa && !descartado) { U.setError('ed-caixa', 'Selecione a caixa/localização.'); ok = false; }
      // Limite de pastas por caixa: só confere quando a pasta MUDA de
      // caixa (manter a atual nunca é bloqueado). A leitura é feita
      // AGORA, porque a ocupação pode ter mudado desde a abertura.
      if (ok && !descartado && String(caixa) !== String(d.caixa_id || '')) {
        const o = await ocupacaoDaCaixa(caixa);
        if (!o) {
          U.setError('ed-caixa', 'Não foi possível conferir a ocupação da caixa '
            + 'selecionada. Tente novamente.');
          ok = false;
        } else if (o.ocup >= o.cap) {
          U.setError('ed-caixa', `A caixa ${o.codigo} já está com ${o.ocup}/${o.cap} pastas `
            + `(máximo). Escolha outra caixa.`);
          ok = false;
        }
      }
      if (!ok) return;

      const btn = document.getElementById('btn-salvar-edicao');
      U.loading(btn, true);
      try {
        await SGA_API.update('documentos', d.id, {
          descricao, tipo, setor, categoria,
          data_documento: dataDoc,
          prazo_guarda: prazo,
          // descartado: caixa_id não é enviado (permanece NULL)
          ...(descartado ? {} : { caixa_id: caixa }),
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
      let caixa = document.getElementById('doc-caixa').value;
      const salaDoc = document.getElementById('doc-sala').value;
      const observacoes = document.getElementById('doc-observacoes').value.trim();

      if (!descricao) { U.setError('doc-descricao', 'O nome é obrigatório.'); ok = false; }
      if (!tipo) { U.setError('doc-tipo', 'Selecione o tipo.'); ok = false; }
      if (!setor) { U.setError('doc-setor', 'Selecione o setor.'); ok = false; }
      if (!categoria) { U.setError('doc-categoria', 'Selecione a categoria.'); ok = false; }
      if (!dataDoc) { U.setError('doc-data', 'Informe a data do documento.'); ok = false; }
      if (!prazo) { U.setError('doc-prazo', 'Informe o prazo de guarda.'); ok = false; }
      if (!salaDoc) { U.setError('doc-sala', 'Selecione a sala.'); ok = false; }
      else if (!caixa) { U.setError('doc-sala', 'Nenhuma caixa livre nesta sala.'); ok = false; }

      // Limite de pastas por caixa: a caixa alocada na abertura pode
      // ter encheido nesse meio tempo (outra aba/usuário). Revalida
      // AGORA e, se estiver cheia, realoca a próxima caixa livre.
      if (ok && caixa) {
        const o = await ocupacaoDaCaixa(caixa);
        if (!o) {
          U.setError('doc-sala', 'Não foi possível conferir a ocupação da caixa. Tente novamente.');
          ok = false;
        } else if (o.ocup >= o.cap) {
          await alocarCaixaPorSala();
          const outra = document.getElementById('doc-caixa').value;
          if (!outra || String(outra) === String(caixa)) {
            U.setError('doc-sala', `Nenhuma caixa livre nesta sala (a ${o.codigo} `
              + `já está com ${o.ocup}/${o.cap} pastas).`);
            ok = false;
          } else {
            caixa = outra;
          }
        }
      }
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
      // Filtro de sala da aba Pesquisa: mesma lista/cache de salas.
      fillSelect('pesq-sala', salas, 'Todas as salas');

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
      else if (d.acao === 'mover-pasta') abrirTransferirPasta({ caixaOrigemId: d.cx });
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
          const cap = capacidadeDaCaixa(c);
          const cheia = n >= cap;
          return `<span class="ed-caixa" title="${U.esc(c.descricao || c.codigo)}">`
            + `<span class="ed-caixa-cod">${U.esc(c.codigo)}</span>`
            + `<span class="ed-caixa-cap${cheia ? ' cheia' : ''}">${n}/${cap}</span>`
            + `<span class="ed-acoes">`
            + `<button class="btn btn-ghost btn-icone" data-acao="mover-pasta" data-cx="${U.esc(c.id)}"`
            + `${n > 0 ? '' : ' disabled'} title="Transferir pasta">↪</button>`
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

    // "+ Incluir estante" só enquanto houver capacidade na sala.
    const btnEst = document.getElementById('btn-ed-incluir-estante');
    if (btnEst) {
      const lotada = edArq.sala && cap > 0 && edArq.estantes.length >= cap;
      btnEst.disabled = !edArq.sala || lotada;
      btnEst.title = lotada
        ? `Capacidade (${cap}) atingida — aumente o campo "Capacidade (estantes)" e salve a sala.`
        : 'Incluir estante';
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
    // Capacidade da sala é limite: não dá para incluir estante além dela.
    const cap = parseInt(document.getElementById('ed-sala-capacidade').value, 10) || 0;
    if (cap > 0 && edArq.estantes.length >= cap) {
      U.toast(`Capacidade da sala atingida: ${edArq.estantes.length}/${cap} estante(s). `
        + 'Aumente o campo "Capacidade (estantes)" e salve a sala antes de incluir outra.',
        'warning');
      return;
    }
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

  /**
   * Transferir CAIXA (com os documentos que guarda) para outra
   * prateleira — na MESMA sala ou em OUTRA sala de arquivo.
   *
   * O modal pergunta primeiro o destino:
   *   - mesma sala: estantes/prateleiras/caixas vêm da própria
   *     árvore (nenhuma consulta nova);
   *   - outra sala: os dados são lidos da sala escolhida.
   *
   * Prateleira cheia (n >= capacidade, máx. MAX_CX_PRAT) ou a
   * ATUAL da caixa vem desabilitada; a ocupação é lida de novo na
   * hora de confirmar e o banco recusa mais uma vez na gravação.
   */
  async function transferirCaixa(caixaId) {
    if (!edArq.sala) return;
    const cx = edArq.caixas.find(c => String(c.id) === String(caixaId));
    if (!cx) return;
    const docs = edArq.docs[cx.id] || 0;
    const salaAtual = edArq.sala;
    const outrasSalas = salasCache.filter(s => String(s.id) !== String(salaAtual.id));
    const pratAtual = cx.prateleira_id ? String(cx.prateleira_id) : '';

    Modal.open(`Transferir caixa ${cx.codigo}`, `
      <form class="form-stack" onsubmit="return false">
        <p class="ed-aviso">Move a caixa com ${docs} documento(s) guardado(s).
          Para onde ela vai? Em outra sala a caixa recebe código novo;
          na mesma sala ela mantém o código.</p>
        <div class="form-group">
          <label>Destino *</label>
          <div class="cx-tipo">
            <label class="cx-tipo-op">
              <input type="radio" name="cx-tipo" value="mesma" checked>
              <span>Mesma Sala de Arquivo</span>
            </label>
            <label class="cx-tipo-op">
              <input type="radio" name="cx-tipo" value="outra"${outrasSalas.length ? '' : ' disabled'}>
              <span>Outra sala de arquivo${outrasSalas.length ? '' : ' (nenhuma cadastrada)'}</span>
            </label>
          </div>
        </div>
        <p class="cx-prev" id="cx-prev-cod"></p>
        <div class="form-group" id="cx-bloco-sala" style="display:none">
          <label for="edf-cx-sala">Sala de destino *</label>
          <select id="edf-cx-sala">${opcoesDestino(outrasSalas, 'Selecione a sala…')}</select>
        </div>
        <div class="form-group">
          <label for="edf-cx-estante">Estante de destino *</label>
          <select id="edf-cx-estante"></select>
        </div>
        <div class="form-group">
          <label for="edf-cx-prateleira">Prateleira de destino *</label>
          <select id="edf-cx-prateleira"></select>
        </div>
      </form>`, botoesModal('Transferir'));

    const blocoSala = document.getElementById('cx-bloco-sala');
    const selSala = document.getElementById('edf-cx-sala');
    const selEst = document.getElementById('edf-cx-estante');
    const selPrat = document.getElementById('edf-cx-prateleira');
    let dados = null; // { estantes, prateleiras, caixas } da sala escolhida
    let seq = 0;      // descarta resposta de um carregamento antigo

    const outraSala = () =>
      (document.querySelector('input[name="cx-tipo"]:checked') || {}).value === 'outra';

    /** Caixas por prateleira (n = caixas com prateleira_id). */
    function contaPorPrat(caixas) {
      const mapa = {};
      (caixas || []).forEach(c => {
        const k = c.prateleira_id ? String(c.prateleira_id) : '';
        mapa[k] = (mapa[k] || 0) + 1;
      });
      return mapa;
    }

    function desenhaEstantes() {
      selPrat.innerHTML = '<option value="">Selecione a estante…</option>';
      selPrat.disabled = true;
      if (!dados) {
        selEst.innerHTML = `<option value="">${outraSala() ? 'Selecione a sala…' : 'Sem dados da sala'}</option>`;
        selEst.disabled = true;
        return;
      }
      if (!dados.estantes.length) {
        selEst.innerHTML = '<option value="">Nenhuma estante nesta sala</option>';
        selEst.disabled = true;
        return;
      }
      const comPrat = new Set((dados.prateleiras || []).map(p => String(p.estante_id)));
      selEst.disabled = false;
      selEst.innerHTML = '<option value="">Selecione a estante…</option>'
        + dados.estantes.map(e => {
          const tem = comPrat.has(String(e.id));
          return `<option value="${U.esc(e.id)}"${tem ? '' : ' disabled'}>`
            + `${U.esc(e.codigo)}${e.descricao ? ' — ' + U.esc(e.descricao) : ''}`
            + `${tem ? '' : ' · sem prateleiras'}</option>`;
        }).join('');
    }

    function desenhaPrateleiras() {
      const estId = selEst.value;
      const lista = (estId && dados)
        ? dados.prateleiras.filter(p => String(p.estante_id) === String(estId)) : [];
      if (!lista.length) {
        selPrat.innerHTML = `<option value="">${estId ? 'Estante sem prateleiras' : 'Selecione a estante…'}</option>`;
        selPrat.disabled = true;
        return;
      }
      const conta = contaPorPrat(dados.caixas);
      const infos = lista.map(p => {
        const n = conta[String(p.id)] || 0;
        const cap = Math.min(p.capacidade || MAX_CX_PRAT, MAX_CX_PRAT);
        const atual = String(p.id) === pratAtual;
        return { p, n, cap, atual, livre: !atual && n < cap };
      });
      const temLivre = infos.some(i => i.livre);
      selPrat.disabled = !temLivre;
      selPrat.innerHTML = `<option value="">${temLivre ? 'Selecione a prateleira…' : 'Nenhuma prateleira livre nesta estante'}</option>`
        + infos.map(({ p, n, cap, atual, livre }) => {
          const marca = atual ? ' · atual'
            : (n >= cap ? ` · CHEIA (${n}/${cap})` : ` (${n}/${cap})`);
          return `<option value="${U.esc(p.id)}"${livre ? '' : ' disabled'}>`
            + `${U.esc(p.codigo)}${p.descricao ? ' — ' + U.esc(p.descricao) : ''}${marca}</option>`;
        }).join('');
    }

    async function carregarOutraSala(salaId) {
      const minhaVez = ++seq;
      dados = null;
      desenhaEstantes();
      if (!salaId) return;
      selEst.disabled = false;
      selEst.innerHTML = '<option value="">Carregando…</option>';
      try {
        const escopo = `&sala_id=eq.${encodeURIComponent(salaId)}`;
        const [ests, prats, cxs] = await Promise.all([
          SGA_API.listTudo('estantes', `${escopo}&order=codigo,id`,
            'id,codigo,descricao,capacidade'),
          SGA_API.listTudo('prateleiras', '&order=codigo,id',
            'id,codigo,descricao,capacidade,estante_id'),
          SGA_API.listTudo('caixas', `${escopo}&order=codigo,id`,
            'id,prateleira_id'),
        ]);
        if (minhaVez !== seq) return; // usuário já mudou de escolha
        const ids = new Set((ests || []).map(e => String(e.id)));
        dados = {
          estantes: ests || [],
          prateleiras: (prats || []).filter(p => ids.has(String(p.estante_id))),
          caixas: cxs || [],
        };
        desenhaEstantes();
      } catch {
        if (minhaVez !== seq) return;
        selEst.innerHTML = '<option value="">Erro ao carregar a sala</option>';
        selEst.disabled = true;
      }
    }

    /**
     * Mostra o código que a caixa VAI TER: na mesma sala ela
     * mantém o código; em outra sala, a proximo_codigo_livre
     * devolve o menor buraco da sequência da sala de destino
     * (banco sem a RPC → linha vazia, a transferência funciona).
     */
    let seqPrev = 0;
    async function mostraPrevCod() {
      const alvo = document.getElementById('cx-prev-cod');
      if (!alvo) return;
      if (!outraSala()) {
        alvo.textContent = `Código mantido: ${cx.codigo} `
          + '(a caixa continua com o mesmo número nesta sala).';
        return;
      }
      const salaId = selSala.value;
      if (!salaId) { alvo.textContent = ''; return; }
      const minhaVez = ++seqPrev;
      alvo.textContent = 'Novo código: consultando…';
      try {
        const cod = await SGA_API.proximoCodigoLivre('caixas', salaId);
        if (minhaVez !== seqPrev) return;
        alvo.textContent = cod ? `Novo código: ${cod}` : '';
      } catch {
        if (minhaVez !== seqPrev) return;
        alvo.textContent = '';
      }
    }

    /** Aplica a escolha (mesma / outra sala) nos três selects. */
    function aplicarTipo() {
      blocoSala.style.display = outraSala() ? '' : 'none';
      ++seq; // invalida carregamento em andamento
      if (outraSala()) {
        carregarOutraSala(selSala.value);
      } else {
        dados = {
          estantes: edArq.estantes || [],
          prateleiras: edArq.prateleiras || [],
          caixas: edArq.caixas || [],
        };
        desenhaEstantes();
      }
      mostraPrevCod();
    }

    document.querySelectorAll('input[name="cx-tipo"]')
      .forEach(r => r.addEventListener('change', aplicarTipo));
    selSala.addEventListener('change', () => {
      carregarOutraSala(selSala.value);
      mostraPrevCod();
    });
    selEst.addEventListener('change', desenhaPrateleiras);

    aplicarTipo(); // começa na MESMA sala, com as opções já prontas

    ligaBotoesModal('Transferir', async () => {
      const mesma = !outraSala();
      const salaId = mesma ? salaAtual.id : selSala.value;
      const estId = selEst.value;
      const pratId = selPrat.value;
      if (!mesma && !salaId) { U.toast('Selecione a sala de destino.', 'warning'); return; }
      if (!estId) { U.toast('Selecione a estante de destino.', 'warning'); return; }
      if (!pratId) { U.toast('Selecione a prateleira de destino.', 'warning'); return; }
      if (String(pratId) === pratAtual) {
        U.toast('A caixa já está nesta prateleira.', 'warning');
        return;
      }

      // Ocupação relida AGORA: o select pode estar desatualizado
      // (outra aba/pessoa pode ter incluído caixa na prateleira).
      const [pratRow, nestaPrat] = await Promise.all([
        SGA_API.listTudo('prateleiras', `&id=eq.${encodeURIComponent(pratId)}`,
          'codigo,capacidade'),
        SGA_API.listTudo('caixas',
          `&prateleira_id=eq.${encodeURIComponent(pratId)}`, 'id'),
      ]);
      const pratNovo = (pratRow || [])[0] || {};
      const cap = Math.min(pratNovo.capacidade || MAX_CX_PRAT, MAX_CX_PRAT);
      const n = (nestaPrat || []).length;
      if (n >= cap) {
        U.toast(`A prateleira ${pratNovo.codigo || ''} já está com ${n}/${cap} caixas `
          + '(máximo). Escolha outra prateleira.', 'warning');
        return;
      }

      const r = await SGA_API.transferirCaixa(cx.id, salaId, estId, pratId);
      Modal.close();
      if (mesma) {
        U.toast(`Caixa ${r.codigo_novo} movida para ${pratNovo.codigo} `
          + `(${salaAtual.codigo}) — ${r.documentos} documento(s) junto(s).`, 'success');
      } else {
        U.toast(`Caixa ${r.codigo_anterior} → ${r.codigo_novo} `
          + `(${r.documentos} documento(s) junto).`, 'success');
      }
      loadLocalSelects();
      await carregarEstruturaSala();
    });
  }

  /**
   * Modal de TRANSFERÊNCIA de PASTA (documento) de uma caixa para
   * outra. Dois caminhos de entrada:
   *   - árvore do Editar Arquivo (caixaOrigemId): o usuário escolhe
   *     QUAL pasta daquela caixa mover e para onde;
   *   - aba Pesquisa (docId): a pasta é a da linha e só falta o
   *     destino (a origem vem de documents.caixa_id).
   *
   * DESTINO, no mesmo critério do Transferir caixa: o modal pergunta
   * "Mesma Sala de Arquivo" (a sala da caixa de origem) ou "Outra
   * sala de arquivo"; a lista de caixas vem do escopo escolhido.
   * Sem dar para saber a sala da origem (banco sem as colunas), o
   * modal continua como sempre: todas as caixas numa lista só.
   *
   * REGRA: caixa de destino já no máximo de pastas (capacidade,
   * padrão MAX_CAP_CAIXA = 5) aparece desabilitada como "CHEIA",
   * e a ocupação é RELIDA do banco na hora de confirmar — com o
   * modal aberto outra pessoa/aba pode ter encheu a caixa.
   */
  async function abrirTransferirPasta({ docId = null, caixaOrigemId = null } = {}) {
    const [caixas, conta] = await Promise.all([
      carregarCaixasCompletas(),
      contarDocumentosPorCaixa(),
    ]);
    if (!caixas) {
      U.toast('Erro ao carregar as caixas. Tente novamente.', 'error');
      return;
    }
    if (!caixas.length) { U.toast('Nenhuma caixa cadastrada.', 'warning'); return; }

    // Pastas candidatas: as da caixa de origem, ou só a da linha.
    let docs = [];
    try {
      if (docId) {
        docs = await SGA_API.listTudo('documentos',
          `&id=eq.${encodeURIComponent(docId)}`, 'id,protocolo,descricao,status,caixa_id');
      } else if (caixaOrigemId) {
        docs = await SGA_API.listTudo('documentos',
          `&caixa_id=eq.${encodeURIComponent(caixaOrigemId)}&order=protocolo`,
          'id,protocolo,descricao,status,caixa_id');
      }
    } catch (err) {
      U.toast(`Erro ao carregar as pastas: ${err.message}`, 'error');
      return;
    }
    // Descartado não está mais no acervo: não se move.
    docs = (docs || []).filter(x => x.status !== 'descartado');
    if (!docs.length) {
      U.toast(caixaOrigemId && !docId
        ? 'Esta caixa não tem pastas para transferir.'
        : 'Este documento não tem pasta a transferir.', 'warning');
      return;
    }

    const origemId = docs[0].caixa_id || '';
    const origem = caixas.find(c => String(c.id) === String(origemId)) || null;

    // Sem nenhuma caixa com vaga não há o que escolher: avisa e
    // nem abre o modal (todas apareceriam desabilitadas).
    const algumaComVaga = caixas.some(c => String(c.id) !== String(origemId)
      && (conta[c.id] || 0) < capacidadeDaCaixa(c));
    if (!algumaComVaga) {
      U.toast('Nenhuma caixa com vaga: todas estão no máximo de pastas.', 'warning');
      return;
    }

    // DESTINO — mesma sala (a da caixa de origem) ou outra sala,
    // como no Transferir caixa. A sala vem do embed da caixa; se o
    // banco caiu na consulta simples, lê sala_id da origem. Sem
    // sala conhecida não há o que escolher e o modal continua
    // como sempre: uma lista só, com todas as caixas.
    const porId = new Map();
    (salasCache || []).forEach(s => porId.set(String(s.id), s));
    (caixas || []).forEach(c => {
      if (c.sala && c.sala.id && !porId.has(String(c.sala.id))) {
        porId.set(String(c.sala.id), c.sala);
      }
    });
    const salaDe = c => (c && c.sala && c.sala.id) ? c.sala
      : ((c && c.sala_id && porId.get(String(c.sala_id))) || null);
    let salaOrigem = origem ? salaDe(origem) : null;
    if (origem && !salaOrigem && origemId) {
      try {
        const r = await SGA_API.listTudo('caixas',
          `&id=eq.${encodeURIComponent(origemId)}`, 'sala_id');
        if (r && r[0] && r[0].sala_id) salaOrigem = porId.get(String(r[0].sala_id)) || null;
      } catch { /* segue sem o escolhidor de destino */ }
    }
    const comTipo = !!salaOrigem;
    const salaOrigemId = comTipo ? String(salaOrigem.id) : '';
    const outrasSalas = comTipo
      ? [...porId.values()]
          .filter(s => String(s.id) !== salaOrigemId)
          .sort((a, b) => String(a.codigo || '')
            .localeCompare(String(b.codigo || ''), 'pt', { numeric: true }))
      : [];

    const local = c => {
      const s = salaDe(c);
      return [s && s.codigo, c.estante?.codigo, c.prateleira?.codigo]
        .filter(Boolean).join(' / ');
    };

    /** Rótulo da caixa com a ocupação: CX-000001 (SL-001 / P-0001) — 3/5 */
    const rotuloCx = (c, comSituacao = true) => {
      const cap = capacidadeDaCaixa(c);
      const ocup = conta[c.id] || 0;
      const loc = local(c);
      const sit = !comSituacao ? ''
        : (ocup >= cap ? ` — CHEIA (${ocup}/${cap})` : ` (${ocup}/${cap})`);
      return `${c.codigo}${loc ? ' (' + loc + ')' : ''}`
        + `${c.descricao ? ' — ' + c.descricao : ''}${sit}`;
    };

    const opsDocs = docs.map(x =>
      `<option value="${U.esc(x.id)}">${U.esc(`${x.protocolo} — ${x.descricao}`)}</option>`).join('');

    /** <option>s das caixas de UM escopo (sala): origem e CHEIAS desabilitadas. */
    const opsCaixas = lista => lista.map(c => {
      const cap = capacidadeDaCaixa(c);
      const ocup = conta[c.id] || 0;
      const naOrigem = String(c.id) === String(origemId);
      const cheia = ocup >= cap;
      const marcador = naOrigem ? ' · origem' : '';
      return `<option value="${U.esc(c.id)}"${naOrigem || cheia ? ' disabled' : ''}>`
        + `${U.esc(rotuloCx(c))}${U.esc(marcador)}</option>`;
    }).join('');

    const origemTxt = origem
      ? `${rotuloCx(origem, false)} — ${conta[origem.id] || 0}/${capacidadeDaCaixa(origem)} pastas`
      : 'Sem caixa (pasta ainda não localizada)';

    const avisoTxt = `Move a pasta para outra caixa${comTipo
      ? ', na mesma sala ou em outra sala de arquivo' : ''}. A caixa de destino já cheia `
      + `(ocupação igual à capacidade, padrão ${MAX_CAP_CAIXA} pastas) aparece `
      + 'bloqueada e não pode ser escolhida.';

    Modal.open(origem ? `Transferir pasta — ${origem.codigo}` : 'Transferir pasta', `
      <form id="form-transferir-pasta" class="form-stack" onsubmit="return false" novalidate>
        <p class="ed-aviso">${avisoTxt}</p>
        <div class="form-group">
          <label for="tp-origem">Caixa de origem</label>
          <input type="text" id="tp-origem" value="${U.esc(origemTxt)}" readonly>
        </div>
        <div class="form-group">
          <label for="tp-doc">Pasta (documento) *</label>
          <select id="tp-doc">${opsDocs}</select>
          <span class="field-error" id="error-tp-doc" role="alert"></span>
        </div>
        ${comTipo ? `
        <div class="form-group">
          <label>Destino *</label>
          <div class="cx-tipo">
            <label class="cx-tipo-op">
              <input type="radio" name="tp-tipo" value="mesma" checked>
              <span>Mesma Sala de Arquivo</span>
            </label>
            <label class="cx-tipo-op">
              <input type="radio" name="tp-tipo" value="outra"${outrasSalas.length ? '' : ' disabled'}>
              <span>Outra sala de arquivo${outrasSalas.length ? '' : ' (nenhuma cadastrada)'}</span>
            </label>
          </div>
        </div>
        <div class="form-group" id="tp-bloco-sala" style="display:none">
          <label for="tp-sala">Sala de destino *</label>
          <select id="tp-sala">${opcoesDestino(outrasSalas, 'Selecione a sala…')}</select>
        </div>` : ''}
        <div class="form-group">
          <label for="tp-destino">Caixa de destino *</label>
          <select id="tp-destino"><option value="">Selecione a caixa…</option></select>
          <span class="field-error" id="error-tp-destino" role="alert"></span>
        </div>
      </form>`, botoesModal('Transferir'));

    const blocoSala = document.getElementById('tp-bloco-sala');
    const selSala = document.getElementById('tp-sala');
    const selDest = document.getElementById('tp-destino');

    const mesmaSala = () => !comTipo
      || (document.querySelector('input[name="tp-tipo"]:checked') || {}).value !== 'outra';

    /** Caixas do escopo escolhido: a sala da origem ou a selecionada. */
    function caixasDoEscopo() {
      if (!comTipo) return caixas;
      const alvo = mesmaSala() ? salaOrigemId : (selSala ? selSala.value : '');
      if (!alvo) return [];
      return caixas.filter(c => {
        const s = salaDe(c);
        return s && String(s.id) === String(alvo);
      });
    }

    function desenhaCaixas() {
      const lista = caixasDoEscopo();
      const temVaga = lista.some(c => String(c.id) !== String(origemId)
        && (conta[c.id] || 0) < capacidadeDaCaixa(c));
      let fill = 'Selecione a caixa…';
      if (comTipo && !mesmaSala() && !(selSala && selSala.value)) fill = 'Selecione a sala…';
      else if (!lista.length) fill = 'Nenhuma caixa nesta sala';
      else if (comTipo && !temVaga) fill = 'Nenhuma caixa com vaga nesta sala';
      selDest.innerHTML = `<option value="">${fill}</option>` + opsCaixas(lista);
      const err = document.getElementById('error-tp-destino');
      if (err) err.textContent = '';
    }

    /** Aplica a escolha (mesma / outra sala) na lista de caixas. */
    function aplicarTipo() {
      if (!comTipo) { desenhaCaixas(); return; }
      blocoSala.style.display = mesmaSala() ? 'none' : '';
      desenhaCaixas();
    }

    if (comTipo) {
      document.querySelectorAll('input[name="tp-tipo"]')
        .forEach(r => r.addEventListener('change', aplicarTipo));
      if (selSala) selSala.addEventListener('change', desenhaCaixas);
    }
    aplicarTipo(); // começa na MESMA sala, com as caixas já listadas

    ligaBotoesModal('Transferir', async () => {
      const form = document.getElementById('form-transferir-pasta');
      U.clearErrors(form);
      const pasta = document.getElementById('tp-doc').value;
      const destino = document.getElementById('tp-destino').value;
      let ok = true;
      if (!pasta) { U.setError('tp-doc', 'Selecione a pasta.'); ok = false; }
      if (comTipo && !mesmaSala() && !(selSala && selSala.value)) {
        U.toast('Selecione a sala de destino.', 'warning');
        ok = false;
      }
      if (!destino) { U.setError('tp-destino', 'Selecione a caixa de destino.'); ok = false; }
      else if (String(destino) === String(origemId)) {
        U.setError('tp-destino', 'A pasta já está nesta caixa.');
        ok = false;
      }
      if (!ok) return;

      // Ocupação relida AGORA: o select pode estar desatualizado.
      const o = await ocupacaoDaCaixa(destino);
      if (!o) {
        U.setError('tp-destino', 'Não foi possível conferir a ocupação da caixa '
          + 'de destino. Tente novamente.');
        return;
      }
      if (o.ocup >= o.cap) {
        U.setError('tp-destino', `A caixa ${o.codigo} já está com ${o.ocup}/${o.cap} `
          + 'pastas (máximo). Escolha outra caixa.');
        return;
      }

      await SGA_API.update('documentos', pasta, { caixa_id: destino });
      Modal.close();
      U.toast(`Pasta transferida para ${o.codigo} — ${o.ocup + 1}/${o.cap} pastas.`, 'success');
      atualizaAposMovimentacao();
    });
  }

  /** Repinta a árvore do Editar Arquivo e os resultados da Pesquisa. */
  function atualizaAposMovimentacao() {
    if (edArq.salaId) carregarEstruturaSala();
    if (docsPesquisa.length) refazerPesquisa();
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
      const livre = (caixas || []).find(c =>
        (conta[c.id] || 0) < capacidadeDaCaixa(c));
      if (!livre) {
        if (info) info.textContent = 'Nenhuma caixa livre nesta sala.';
        return;
      }
      hid.value = livre.id;
      const ocup = conta[livre.id] || 0;
      const cap = capacidadeDaCaixa(livre);
      if (info) info.textContent = `Caixa alocada: ${U.locLabel(livre)} — ${ocup}/${cap} pastas`;
    } catch (err) {
      if (info) info.textContent = 'Erro ao alocar a caixa.';
      console.warn('alocarCaixaPorSala:', err.message);
    }
  }

  /** Quantidade de documentos por caixa ({ caixa_id: n }). */
  async function contarDocumentosPorCaixa() {
    try {
      const docs = await SGA_API.listTudo('documentos', '', 'caixa_id,status');
      const conta = {};
      (docs || []).forEach(d => {
        // Descartado não ocupa caixa (sql/19 tira caixa_id), mas o
        // filtro aqui garante o mesmo resultado mesmo com um banco
        // ainda sem a migração aplicada.
        if (d.caixa_id && d.status !== 'descartado') {
          conta[d.caixa_id] = (conta[d.caixa_id] || 0) + 1;
        }
      });
      return conta;
    } catch {
      return {};
    }
  }

  /**
   * Pastas por caixa para o MAPA do arquivo: { total, descarte }.
   *   total    = pastas que ocupam a caixa (NÃO descartadas);
   *   descarte = dessas, com prazo de guarda vencido — o mesmo
   *              critério do card "Para Descarte" do Painel.
   * É a base das cores do mapa (cheia e toda p/ descarte em
   * vermelha; ✓ vermelho onde só ALGUMAS pastas são p/ descarte).
   * Só o mapa usa isto: as demais telas continuam com
   * contarDocumentosPorCaixa().
   */
  async function resumoPastasPorCaixa() {
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const docs = await SGA_API.listTudo('documentos', '', 'caixa_id,status,prazo_guarda');
      const total = {}, descarte = {};
      (docs || []).forEach(d => {
        if (!d.caixa_id || d.status === 'descartado') return;
        total[d.caixa_id] = (total[d.caixa_id] || 0) + 1;
        if (d.prazo_guarda && d.prazo_guarda <= hoje) {
          descarte[d.caixa_id] = (descarte[d.caixa_id] || 0) + 1;
        }
      });
      return { total, descarte };
    } catch {
      return { total: {}, descarte: {} };
    }
  }

  /**
   * Capacidade de uma caixa em nº de pastas. Capacidade vazia/zero
   * cai no padrão (MAX_CAP_CAIXA) — mesma regra da árvore do
   * Editar Arquivo, que já exibe "n/5".
   */
  function capacidadeDaCaixa(cx) {
    const n = Number(cx && cx.capacidade);
    return n > 0 ? n : MAX_CAP_CAIXA;
  }

  /**
   * Carrega TODAS as caixas. A primeira tentativa traz o endereço
   * completo (sala/estante/prateleira); se essa consulta falhar,
   * cai para colunas mínimas — a lista de caixas é o que importa
   * num modal de transferência, e local incompleto é melhor que
   * select vazio ("sistema não permite transferir").
   * Devolve [] quando não há caixas e null quando nada funcionou.
   */
  async function carregarCaixasCompletas() {
    // 1ª: com a SALA embutida (id+codigo+descricao — o Transferir
    //     pasta precisa da sala p/ o destino "mesma sala");
    // 2ª: sem embed, mas com a coluna sala_id (o chamador resolve
    //     a sala pelo cache de salas);
    // 3ª: mínimo absoluto (banco antigo).
    const tentativas = [
      'id,codigo,descricao,capacidade,sala:salas(id,codigo,descricao),estante:estantes(codigo),prateleira:prateleiras(codigo)',
      'id,codigo,descricao,capacidade,sala_id',
      'id,codigo',
    ];
    for (const cols of tentativas) {
      try {
        return await SGA_API.listTudo('caixas', '&order=codigo', cols);
      } catch { /* tenta a consulta mais simples */ }
    }
    return null;
  }

  /**
   * Ocupação ATUAL de uma caixa, lida do banco no momento da
   * conferência (não usa o valor cacheado da abertura da tela).
   * Devolve { codigo, cap, ocup } ou null quando a caixa não existe
   * ou a leitura falhou — nesse caso quem chama deve BLOQUEAR a
   * movimentação (fechar a falha é melhor que deixar passar).
   */
  async function ocupacaoDaCaixa(caixaId) {
    try {
      const id = String(caixaId);
      // Descartado não conta como ocupante: ele já saiu da caixa
      // (sql/19) e o filtro cobre bancos ainda sem a migração.
      const filtro = `&caixa_id=eq.${encodeURIComponent(id)}&status=neq.descartado`;
      const [cxs, docs] = await Promise.all([
        SGA_API.listTudo('caixas', `&id=eq.${encodeURIComponent(id)}`, 'id,codigo,capacidade'),
        SGA_API.listTudo('documentos', filtro, 'id'),
      ]);
      const cx = (cxs || [])[0];
      if (!cx) return null;
      return { codigo: cx.codigo, cap: capacidadeDaCaixa(cx), ocup: (docs || []).length };
    } catch {
      return null;
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
     vencem em até JANELA_VENCIMENTO_DIAS dias
     ============================================================ */
  // Janela da tela: documentos vencidos ou a vencer em até 5 dias.
  // O botão Descartar segue exatamente o mesmo corte, e só aparece
  // para quem não está emprestado.
  const JANELA_VENCIMENTO_DIAS = 5;

  async function loadTemporalidade() {
    const tbody = document.querySelector('#table-temporalidade tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Carregando…</td></tr>';

    try {
      const docs = await SGA_API.list(
        'documentos',
        '&order=prazo_guarda.asc&limit=2000',
        'id,protocolo,descricao,setor,prazo_guarda,status'
      );

      const hoje = U.hoje();
      const limite = new Date(Date.now() + JANELA_VENCIMENTO_DIAS * 86400000)
        .toISOString().slice(0, 10);

      // Vencidos (prazo <= hoje) + os que vencem em até 5 dias.
      // O filtro é o mesmo que decide se a linha tem o botão
      // Descartar: quem não aparece aqui também não é descartável.
      const lista = (docs || [])
        .filter(d => d.prazo_guarda && d.status !== 'descartado' && d.prazo_guarda <= limite)
        .sort((a, b) => a.prazo_guarda.localeCompare(b.prazo_guarda));

      document.getElementById('temp-count').textContent = lista.length;

      if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">'
          + `Nenhum documento vencido ou a vencer em até ${JANELA_VENCIMENTO_DIAS} dias</td></tr>`;
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
        // Emprestado não pode ser descartado (a regra está no banco):
        // o botão fica desabilitado com o motivo no title.
        const bloqueado = d.status === 'emprestado';
        return `
        <tr>
          <td class="cell-protocolo"><strong>${U.esc(d.protocolo)}</strong></td>
          <td><span class="cell-desc" title="${U.esc(d.descricao)}">${U.esc(d.descricao)}</span></td>
          <td>${U.esc(d.setor)}</td>
          <td class="cell-protocolo">${U.fmtData(d.prazo_guarda)}</td>
          <td>${situacao}</td>
          <td>
            ${bloqueado
              ? '<button type="button" class="btn btn-ghost btn-sm" disabled '
                + 'title="Documento emprestado: registre a devolução antes de descartar">Descartar</button>'
              : `<button type="button" class="btn btn-danger btn-sm temp-descartar"
                   data-descartar="${U.esc(d.id)}"
                   data-doc='${U.esc(JSON.stringify({
                     id: d.id, protocolo: d.protocolo, descricao: d.descricao,
                     setor: d.setor, prazo_guarda: d.prazo_guarda,
                     status: d.status, dias,
                   }))}'
                   title="Descartar este documento">Descartar</button>`}
          </td>
        </tr>`;
      }).join('');

      // Um único listener por linha (o tbody é recriado a cada carga)
      tbody.querySelectorAll('[data-descartar]').forEach(btn => {
        btn.addEventListener('click', () => descartarDaTemporalidade(btn));
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Erro: ${U.esc(err.message)}</td></tr>`;
      U.toast(err.message, 'error');
    }
  }

  /**
   * Pop-up de confirmação do descarte.
   *
   * Mostra os dados do documento, quem está logado (é isso que vai
   * para o log de auditoria) e a data/hora prevista. O botão só
   * age depois do clique em "Descartar".
   *
   * `forcar` reexibe o modal avisando que o banco recusou por
   * prazo de guarda ainda não vencido: aí o p_confirmar = true.
   */
  function abrirConfirmacaoDescarte(doc, forcar, aoConcluir) {
    const usuario = SGA_API.getStoredUser() || {};
    const dataHora = new Date().toLocaleString('pt-BR');
    const vencido = Number(doc.dias) < 0;

    const aviso = forcar
      ? '<p class="descarte-aviso">'
        + '<strong>Atenção:</strong> o prazo de guarda deste documento ainda não venceu. '
        + 'Confirmar agora registra o descarte como decisão deliberada.'
        + '</p>'
      : '';

    const linhas = [
      ['Protocolo', U.esc(doc.protocolo || '—')],
      ['Descrição', U.esc(doc.descricao || '—')],
      ['Setor', U.esc(doc.setor || '—')],
      ['Prazo de Guarda', `${U.fmtData(doc.prazo_guarda)} (${vencido
        ? 'vencido'
        : `vence em ${doc.dias} dia${Number(doc.dias) === 1 ? '' : 's'}`})`],
      ['Descartado por', U.esc(usuario.nome || usuario.email || 'usuário logado')],
      ['Perfil', U.esc(usuario.perfil === 'admin' ? 'Administrador' : 'Arquivista')],
      ['Data e hora do descarte', dataHora],
    ];

    const body = `${aviso}<dl>${linhas
      .map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('')}</dl>
      <p class="descarte-aviso">
        O documento é retirado da caixa e deixa de constar na sala do
        arquivo (mapa, árvore, ocupação e busca por sala), liberando a
        vaga que ocupava. Ele passa a contar como descarte no gráfico
        do painel e o histórico permanece: log “DESCARTE” na Auditoria
        com o seu nome, a data, a hora e a localização anterior.
      </p>`;

    const footer = '<button class="btn btn-ghost" id="descartar-cancelar">Cancelar</button>'
      + `<button class="btn btn-danger" id="descartar-confirmar">Descartar</button>`;

    Modal.open('Confirmar descarte', body, footer);

    document.getElementById('descartar-cancelar')
      .addEventListener('click', () => Modal.close());
    document.getElementById('descartar-confirmar')
      .addEventListener('click', () => aoConcluir(doc, forcar));
  }

  /**
   * Descarta o documento e recarrega a lista.
   *
   * A RPC (sql/19) recusa o descarte antes do vencimento ou sem
   * prazo definido; nesse caso o pop-up reabre com o aviso e o
   * pedido é reenviado com p_confirmar = true — a decisão é do
   * arquivista, não do código.
   */
  async function descartarDaTemporalidade(btn) {
    let doc;
    try {
      doc = JSON.parse(btn.dataset.doc);
    } catch {
      U.toast('Não foi possível ler os dados do documento.', 'error');
      return;
    }

    // `forcar` = true reabre o mesmo modal com o aviso de prazo
    // ainda não vencido (o banco recusou o pedido anterior).
    const tentar = (forcar, botao) => {
      abrirConfirmacaoDescarte(doc, forcar, async (d, confirmar) => {
        if (botao) {
          if (botao.disabled) return;
          botao.disabled = true;
          U.loading(botao, true);
        }
        try {
          await SGA_API.descartarDocumento(d.id, confirmar);
          Modal.close();
          U.toast(`Documento ${d.protocolo} descartado por `
            + `${(SGA_API.getStoredUser() || {}).nome || 'você'}. `
            + 'Ele saiu da caixa e da sala do arquivo; o histórico '
            + 'permanece na Auditoria.', 'success');
          loadTemporalidade();
          // A pasta saiu da caixa: repinta a árvore do Editar
          // Arquivo e os resultados da Pesquisa, senão a ocupação
          // mostrada continuaria a de antes do descarte.
          atualizaAposMovimentacao();
        } catch (err) {
          const msg = err.message || '';
          Modal.close();
          // Recusa por prazo ainda não vencido: reabre o modal
          // mostrando o motivo, em vez de um confirm() solto.
          if (!confirmar && /prazo de guarda/i.test(msg)) return tentar(true, botao);
          U.toast(msg, 'error');
        } finally {
          if (botao) {
            botao.disabled = false;
            U.loading(botao, false);
          }
        }
      });
    };

    tentar(false, btn);
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
      DESCARTE: 'status-atrasado',
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
