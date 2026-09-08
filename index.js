// =====================================================================
// index.js — App público SUMED 2026
// Requer: supabaseClient.js, data.js carregados antes deste arquivo.
// =====================================================================

const REGULAMENTO_PADRAO = `
  <h3>1. FASE CLASSIFICATÓRIA</h3>
  <p>13 equipes jogam em sistema todos contra todos em 13 rodadas (uma folga por rodada, nunca repetida).</p>
  <br>
  <h3>2. PONTUAÇÃO E CRITÉRIOS DE DESEMPATE</h3>
  <p>Vitória: 3 pontos | Empate: 1 ponto | Derrota: 0 pontos.</p>
  <p>Critérios em ordem (Art. 18º): 1º Nº de Vitórias, 2º Gols Marcados (GP), 3º Saldo de Gols (SG), 4º Confronto Direto (quando aplicável), 5º Menor nº de cartões vermelhos, 6º Menor nº de cartões amarelos, 7º Sorteio.</p>
  <br>
  <h3>3. CLASSIFICAÇÃO</h3>
  <p><b>1º ao 8º:</b> Classificados para a SUMED Ouro.</p>
  <p><b>9º ao 12º:</b> Classificados para a SUMED Prata.</p>
  <p><b>13º:</b> Eliminado.</p>
`;

const TIPO_EVENTO_LABEL_PUBLICO = {
  cartao_amarelo: '🟨', cartao_vermelho: '🟥', contusao: '🩹',
  punicao: '⚠️', suspensao: '⛔', outro: '📌',
};

let state = {
  categoria: 'masculino',
  fase: 'ouro',
  selectedRound: 1,
  teams: [],
  matches: [],
  eventos: [],
};

// ---------------------------------------------------------------------
// BANNER DE INSTALAÇÃO DO APP
// ---------------------------------------------------------------------
let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  maybeShowInstallBanner();
});

window.addEventListener('appinstalled', dismissInstallBanner);

function maybeShowInstallBanner() {
  if (isStandalone()) return;
  if (localStorage.getItem('sumed_install_dismissed') === '1') return;

  const banner = document.getElementById('install-banner');
  if (!banner) return;

  if (isIOS()) {
    document.getElementById('install-banner-sub').textContent = 'Toque em Compartilhar e depois "Adicionar à Tela de Início".';
    const btn = document.getElementById('install-banner-btn');
    btn.textContent = 'Como instalar';
    btn.onclick = showIOSInstallInstructions;
    banner.style.display = 'flex';
  } else if (deferredInstallPrompt) {
    const btn = document.getElementById('install-banner-btn');
    btn.textContent = 'Instalar';
    btn.onclick = triggerInstallPrompt;
    banner.style.display = 'flex';
  }
}

async function triggerInstallPrompt() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dismissInstallBanner();
}

function showIOSInstallInstructions() {
  document.getElementById('modal-title').innerText = 'Instalar no iPhone';
  document.getElementById('modal-body').innerHTML = `
    <p style="line-height:1.8; font-size:0.95rem;">
      1. Toque no ícone de <b>Compartilhar</b> (o quadrado com uma seta pra cima) na barra do Safari.<br><br>
      2. Role a lista de opções e toque em <b>"Adicionar à Tela de Início"</b>.<br><br>
      3. Toque em <b>Adicionar</b>, no canto superior direito.
    </p>
  `;
  document.getElementById('app-modal').classList.add('active');
}

function dismissInstallBanner() {
  localStorage.setItem('sumed_install_dismissed', '1');
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'none';
}

// ---------------------------------------------------------------------
// IDENTIDADE VISUAL (logo do torneio + patrocinador master)
// ---------------------------------------------------------------------
const IDENTIDADE_PADRAO = { logo_torneio: null, patrocinador_master_logo: null, patrocinador_master_link: null };

async function loadIdentidadeVisual() {
  try {
    const cfg = await fetchConfig('identidade_visual', IDENTIDADE_PADRAO);
    aplicarLogosCabecalho(cfg);
    aplicarIconeDoApp(cfg.logo_torneio);
  } catch (e) {
    console.error('Erro ao carregar identidade visual:', e);
  }
}

function aplicarLogosCabecalho(cfg) {
  if (cfg.logo_torneio) {
    document.getElementById('topbar-logo-torneio').innerHTML = `<img src="${cfg.logo_torneio}" alt="Logo do torneio" loading="lazy" decoding="async" onerror="this.onerror=null; this.style.display='none';">`;
  }
  const masterEl = document.getElementById('topbar-logo-master');
  if (cfg.patrocinador_master_logo) {
    const conteudo = `<img src="${cfg.patrocinador_master_logo}" alt="Patrocinador Master">`;
    const box = masterEl.querySelector('.sponsor-master-logo-box');
    box.innerHTML = cfg.patrocinador_master_link
      ? `<a href="${cfg.patrocinador_master_link}" target="_blank" rel="noopener">${conteudo}</a>`
      : conteudo;
    masterEl.style.display = 'flex';
  }
}

// Troca o ícone que o navegador usa ao "Adicionar à Tela de Início" —
// tanto no Android (via manifest dinâmico) quanto no iPhone (via
// apple-touch-icon). Precisa rodar cedo, antes do usuário instalar.
function aplicarIconeDoApp(logoUrl) {
  if (!logoUrl) return;

  const appleTouchIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleTouchIcon) appleTouchIcon.href = logoUrl;

  const manifestBase = {
    name: 'SUMED 2026 — Superliga Universitária de Medicina',
    short_name: 'SUMED 2026',
    description: 'Acompanhe a Superliga Universitária de Medicina 2026: tabela, jogos, mata-mata e equipes.',
    start_url: '/index.html',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#111415',
    theme_color: '#111415',
    icons: [
      { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  const blob = new Blob([JSON.stringify(manifestBase)], { type: 'application/json' });
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) manifestLink.href = URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------
// NAVEGAÇÃO
// ---------------------------------------------------------------------
const NAV_MAP = { home: 'home', rodadas: 'home', tabela: 'tabela', chaves: 'chaves', equipes: 'equipes', 'team-profile': 'equipes' };

function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-' + screenId).classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
  const navTarget = NAV_MAP[screenId];
  document.querySelector(`.bottom-nav-item[data-screen="${navTarget}"]`)?.classList.add('active');

  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// TOGGLE MASCULINO / FEMININO
// ---------------------------------------------------------------------
function renderCategoriaToggles() {
  const html = `
    <button class="pill-btn ${state.categoria === 'masculino' ? 'active' : ''}" onclick="setCategoria('masculino')">Masculino</button>
    <button class="pill-btn ${state.categoria === 'feminino' ? 'active' : ''}" onclick="setCategoria('feminino')">Feminino</button>
  `;
  document.querySelectorAll('[data-categoria-toggle]').forEach(el => el.innerHTML = html);
}

async function setCategoria(categoria) {
  if (state.categoria === categoria) return;
  state.categoria = categoria;
  state.selectedRound = 1;
  state.heroRound = null;
  state._selecaoCache = null;
  liveDismissed = false;
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (liveEventsChannel) { sb.removeChannel(liveEventsChannel); liveEventsChannel = null; }
  renderCategoriaToggles();
  await loadData();
  renderAll();
  checkLiveMatch();
}

// ---------------------------------------------------------------------
// CARGA DE DADOS
// ---------------------------------------------------------------------
async function loadData() {
  [state.teams, state.matches, state.eventos] = await Promise.all([
    fetchTeams(state.categoria),
    fetchMatches(state.categoria),
    fetchEventosDaCategoria(state.categoria),
  ]);
}

// Confronto direto (Art. 18º, item 4) só é "aplicável" de forma segura
// entre duas equipes específicas — comparamos os jogos que elas disputaram
// entre si (pode ter sido ida e volta, dependendo do formato). Vitórias no
// confronto decidem primeiro; persistindo o empate, gols marcados no
// confronto direto. Retorna >0 se a equipe A leva vantagem, <0 se é a B,
// 0 se não há confronto registrado entre as duas ou seguem empatadas nele.
function confrontoDireto(equipeAId, equipeBId) {
  let vA = 0, vB = 0, gA = 0, gB = 0;
  state.matches.forEach(m => {
    if (m.is_bye || m.status !== 'FINISHED' || m.placar_a === null || m.placar_b === null) return;
    if (m.equipe_a === equipeAId && m.equipe_b === equipeBId) {
      gA += m.placar_a; gB += m.placar_b;
      if (m.placar_a > m.placar_b) vA++; else if (m.placar_b > m.placar_a) vB++;
    } else if (m.equipe_a === equipeBId && m.equipe_b === equipeAId) {
      gB += m.placar_a; gA += m.placar_b;
      if (m.placar_a > m.placar_b) vB++; else if (m.placar_b > m.placar_a) vA++;
    }
  });
  if (vA !== vB) return vA - vB;
  if (gA !== gB) return gA - gB;
  return 0;
}

function calculateStandings() {
  const stats = {};
  state.teams.forEach(t => { stats[t.id] = { id: t.id, name: t.nome, P: 0, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0, SG: 0, CV: 0, CA: 0 }; });

  state.matches.forEach(m => {
    if (m.status === 'FINISHED' && m.placar_a !== null && m.placar_b !== null) {
      const tA = stats[m.equipe_a], tB = stats[m.equipe_b];
      if (tA && tB) {
        tA.J++; tB.J++;
        tA.GP += m.placar_a; tA.GC += m.placar_b;
        tB.GP += m.placar_b; tB.GC += m.placar_a;
        if (m.placar_a > m.placar_b) { tA.V++; tA.P += 3; tB.D++; }
        else if (m.placar_b > m.placar_a) { tB.V++; tB.P += 3; tA.D++; }
        else { tA.E++; tA.P += 1; tB.E++; tB.P += 1; }
      }
    }
  });

  // Art. 18º, itens 5 e 6: menor número de cartões vermelhos/amarelos.
  (state.eventos || []).forEach(ev => {
    const t = stats[ev.equipe_id];
    if (!t) return;
    if (ev.tipo === 'cartao_vermelho') t.CV++;
    else if (ev.tipo === 'cartao_amarelo') t.CA++;
  });

  Object.values(stats).forEach(t => t.SG = t.GP - t.GC);

  // Art. 18º — Critérios de desempate, em ordem:
  // 1) vitórias, 2) gols marcados, 3) saldo de gols, 4) confronto direto,
  // 5) menos cartões vermelhos, 6) menos cartões amarelos, 7) sorteio.
  // O "sorteio" (item 7) não pode ser feito por um algoritmo determinístico,
  // então usamos ordem alfabética apenas como critério estável de exibição
  // — nesse caso raríssimo, o sorteio real deve ser feito manualmente pela
  // organização.
  return Object.values(stats).sort((a, b) => {
    if (b.P !== a.P) return b.P - a.P;
    if (b.V !== a.V) return b.V - a.V;
    if (b.GP !== a.GP) return b.GP - a.GP;
    if (b.SG !== a.SG) return b.SG - a.SG;
    const cd = confrontoDireto(a.id, b.id);
    if (cd !== 0) return -cd;
    if (a.CV !== b.CV) return a.CV - b.CV;
    if (a.CA !== b.CA) return a.CA - b.CA;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------
// HOME — Carrossel da Próxima Rodada (um card por partida)
// ---------------------------------------------------------------------
async function renderHero() {
  const el = document.getElementById('hero-carousel');
  const label = document.getElementById('proxima-rodada-label');
  if (!el) return;

  // Na primeira renderização (ou troca de categoria), parte da rodada mais
  // próxima que ainda tem jogo agendado/ao vivo; depois disso, respeita a
  // navegação manual do usuário pelas setas ‹ ›.
  if (state.heroRound === null || state.heroRound === undefined) {
    const rodadasComJogo = state.matches.filter(m => !m.is_bye && (m.status === 'SCHEDULED' || m.status === 'LIVE'));
    state.heroRound = rodadasComJogo.length ? Math.min(...rodadasComJogo.map(m => m.rodada)) : 1;
  }

  const jogosDaRodada = state.matches.filter(m => !m.is_bye && m.rodada === state.heroRound);
  const isProximaAutomatica = jogosDaRodada.some(m => m.status === 'SCHEDULED' || m.status === 'LIVE');
  label.innerText = `${isProximaAutomatica ? 'Próxima Rodada' : 'Rodada'} — Rodada ${state.heroRound}`;

  if (!jogosDaRodada.length) {
    el.innerHTML = `<div class="card card-accent hero-card"><p style="color:var(--text-muted); padding:20px 0; text-align:center;">Nenhum jogo nesta rodada. Gere o sorteio no painel admin.</p></div>`;
    return;
  }

  el.innerHTML = jogosDaRodada.map(m => {
    const teamA = state.teams.find(t => t.id === m.equipe_a);
    const teamB = state.teams.find(t => t.id === m.equipe_b);
    const aoVivo = m.status === 'LIVE';

    return `
      <div class="card card-accent hero-card">
        ${aoVivo ? `<div class="hero-live-tag"><span class="dot"></span> Ao Vivo</div>` : ''}
        <div class="hero-vs">
          <div class="hero-team">
            <div class="hero-shield" style="cursor:pointer;" onclick="openTeamProfile('${teamA?.id}')">
              ${teamA?.escudo_url ? `<img src="${teamA.escudo_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='⚽';">` : '⚽'}
            </div>
            <div class="hero-team-name" style="cursor:pointer;" onclick="openTeamProfile('${teamA?.id}')">${teamA?.nome || 'A definir'}</div>
          </div>
          <div class="hero-team">
            <div class="hero-team">
          <div class="hero-shield" style="cursor:pointer;" onclick="openTeamProfile('${teamB?.id}')">
            ${teamB?.escudo_url ? `<img src="${teamB.escudo_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='🏁';">` : '🏁'}
          </div>
            <div class="hero-team-name" style="cursor:pointer;" onclick="openTeamProfile('${teamB?.id}')">${teamB?.nome || 'A definir'}</div>
          </div>
        </div>
        <div class="hero-meta">${aoVivo ? `${m.placar_a ?? 0} × ${m.placar_b ?? 0}` : (m.data ? formatDate(m.data) : 'Data a definir')}${!aoVivo && m.hora ? ', ' + m.hora : ''}</div>
        <span class="hero-tag">Rodada ${m.rodada}</span>
        <div class="hero-location">📍 ${m.local || 'Campo Principal'}</div>
        <div id="hero-lineup-${m.id}" class="hero-lineup-badge">Verificando escalação...</div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-action" style="flex:1;" onclick="openSumula('${m.id}')">Detalhes</button>
          <button class="btn-secondary" onclick="openEscalacoes('${m.id}')">👥</button>
        </div>
      </div>
    `;
  }).join('');

  jogosDaRodada.forEach(m => renderHeroLineupBadge(m.id));
}

function changeHeroRound(dir) {
  state.heroRound = Math.min(13, Math.max(1, (state.heroRound || 1) + dir));
  renderHero();
}

function scrollHeroCarousel(dir) {
  const el = document.getElementById('hero-carousel');
  const card = el.querySelector('.hero-card');
  const scrollAmount = card ? card.offsetWidth + 12 : 300;
  el.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
}

async function renderHeroLineupBadge(matchId) {
  const el = document.getElementById(`hero-lineup-${matchId}`);
  if (!el) return;
  try {
    const escalacao = await fetchEscalacao(matchId);
    const pronta = escalacao.filter(e => e.titular).length > 0;
    el.textContent = pronta ? '📋 Escalação confirmada' : '⏳ Escalação pendente';
    el.classList.toggle('pronta', pronta);
  } catch (e) {
    el.textContent = '';
  }
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------
// RODADAS
// ---------------------------------------------------------------------
function changeRound(dir) {
  state.selectedRound = Math.min(13, Math.max(1, state.selectedRound + dir));
  renderRodadas();
  renderSelecaoRodada();
}

function renderRodadas() {
  document.getElementById('current-round-title').innerText = `Rodada ${state.selectedRound}`;
  const container = document.getElementById('matches-container');
  const byeContainer = document.getElementById('bye-container');

  const roundMatches = state.matches.filter(m => m.rodada === state.selectedRound);

  if (roundMatches.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">Sorteio do calendário ainda não realizado.</p>';
    byeContainer.innerHTML = '';
    return;
  }

  let html = '';
  let byeTeam = null;

  roundMatches.forEach(m => {
    if (m.is_bye) {
      byeTeam = state.teams.find(x => x.id === m.equipe_a)?.nome || 'Equipe';
      return;
    }
    const teamAObj = state.teams.find(t => t.id === m.equipe_a);
    const teamBObj = state.teams.find(t => t.id === m.equipe_b);
    const teamA = teamAObj?.nome || 'Time A';
    const teamB = teamBObj?.nome || 'Time B';
    const scoreA = m.placar_a !== null ? m.placar_a : '-';
    const scoreB = m.placar_b !== null ? m.placar_b : '-';
    const extras = m.teve_prorrogacao ? ' <span style="color:var(--gold);">(PRO)</span>' : '';
    const penaltis = m.teve_penaltis ? ' <span style="color:var(--gold);">⚽ pên.</span>' : '';

    html += `
      <div class="match-card">
        <div class="match-meta">
          <span>📅 ${m.data ? formatDate(m.data) : 'A definir'} • ${m.hora || '--:--'}</span>
          <span>📍 ${m.local || 'Campo Principal'}</span>
        </div>
        <div class="match-teams">
          <div class="team-box" style="cursor:pointer;" onclick="openTeamProfile('${teamAObj?.id}')">${teamA}</div>
          <div class="score">${scoreA} × ${scoreB}${extras}${penaltis}</div>
          <div class="team-box away" style="cursor:pointer;" onclick="openTeamProfile('${teamBObj?.id}')">${teamB}</div>
        </div>
        <div id="match-extras-${m.id}" style="margin-top:8px; font-size:0.75rem; color:var(--text-muted);"></div>
        <div style="display:flex; justify-content:space-between; margin-top:8px;">
          <button onclick="openEscalacoes('${m.id}')" style="background:none; border:none; color:var(--gold-bright); font-size:0.78rem; cursor:pointer;">👥 Escalações</button>
          <button onclick="openSumula('${m.id}')" style="background:none; border:none; color:var(--gold-bright); font-size:0.78rem; cursor:pointer;">📄 Ver Súmula</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  byeContainer.innerHTML = byeTeam ? `<div class="bye-card">⏸️ <b>Folga na rodada:</b> ${byeTeam}</div>` : '';

  // Carrega artilheiros + cartões inline (não bloqueia a renderização inicial)
  roundMatches.filter(m => !m.is_bye && m.status === 'FINISHED').forEach(m => renderMatchExtras(m.id));
}

async function renderMatchExtras(matchId) {
  const el = document.getElementById(`match-extras-${matchId}`);
  if (!el) return;
  try {
    const [gols, eventos] = await Promise.all([
      fetchGols(matchId),
      fetchEventos({ partidaId: matchId }),
    ]);
    const linhas = [];
    if (gols.length) {
      linhas.push(gols.map(g => `⚽ ${g.marcador?.nome}${g.assistente?.nome ? ` (assist: ${g.assistente.nome})` : ''}${g.minuto ? " " + g.minuto + "'" : ''}${g.tipo === 'prorrogacao' ? ' (PRO)' : ''}`).join(' · '));
    }
    const cartoes = eventos.filter(e => e.tipo === 'cartao_amarelo' || e.tipo === 'cartao_vermelho');
    if (cartoes.length) {
      linhas.push(cartoes.map(c => `${TIPO_EVENTO_LABEL_PUBLICO[c.tipo]} ${c.jogadores?.nome}`).join(' · '));
    }
    el.innerHTML = linhas.join('<br>');
  } catch (e) { console.error(e); }
}

// ---------------------------------------------------------------------
// TABELA
// ---------------------------------------------------------------------
function renderTabela() {
  const standings = calculateStandings();
  const tbody = document.getElementById('table-standings');
  if (!tbody) return;
  renderArtilheiros();
  renderAssistencias();

  tbody.innerHTML = standings.map((t, index) => {
    const pos = index + 1;
    let zoneClass = 'zone-elim';
    if (pos <= 8) zoneClass = 'zone-ouro';
    else if (pos <= 12) zoneClass = 'zone-prata';

    const equipe = state.teams.find(x => x.id === t.id);
    const escudoHtml = equipe?.escudo_url ? `<img src="${equipe.escudo_url}">` : '🛡️';

    return `
      <tr class="${zoneClass}">
        <td class="pos-cell">${pos}º</td>
        <td><div class="standings-shield" onclick="openTeamProfile('${t.id}')">
          ${equipe?.escudo_url ? `<img src="${equipe.escudo_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='🛡️';">` : '🛡️'}
        </div></td>
        <td onclick="openTeamProfile('${t.id}')">${t.name}</td>
        <td class="pts-cell">${t.P}</td>
        <td>${t.J}</td>
        <td>${t.V}</td>
        <td>${t.E}</td>
        <td>${t.D}</td>
        <td>${t.GP}</td>
        <td>${t.GC}</td>
        <td>${t.SG > 0 ? '+' : ''}${t.SG}</td>
      </tr>
    `;
  }).join('');
}

async function renderArtilheiros() {
  const el = document.getElementById('lista-artilheiros');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Carregando...</p>';
  try {
    const artilheiros = await fetchArtilheiros(state.categoria);
    el.innerHTML = artilheiros.length
  ? `<div class="standings-wrap">${artilheiros.map((a, i) => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-top:${i === 0 ? 'none' : '1px solid var(--border-soft)'}; cursor:pointer;" onclick="openJogadorPerfil('${a.jogador_id}')">
        <b style="width:18px; color:var(--text-muted);">${i + 1}º</b>
        <div class="roster-avatar" style="width:32px; height:32px;">
          ${a.foto_url ? `<img src="${a.foto_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='⚽';">` : '⚽'}
        </div>
        <div style="flex:1;"><b>${a.nome}</b> <span style="color:var(--text-muted); font-size:0.78rem;">${a.equipe || ''}</span></div>
        <b style="color:var(--gold-bright);">${a.gols}</b>
      </div>
    `).join('')}</div>`
  : '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum gol registrado ainda.</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger-strong); font-size:0.85rem;">Erro: ${e.message}</p>`;
  }
}

async function renderAssistencias() {
  const el = document.getElementById('lista-assistencias');
  if (!el) return;
  el.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Carregando...</p>';
  try {
    const assistencias = await fetchAssistencias(state.categoria);
    el.innerHTML = assistencias.length
      ? `<div class="standings-wrap">${assistencias.map((a, i) => `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-top:${i === 0 ? 'none' : '1px solid var(--border-soft)'}; cursor:pointer;" onclick="openJogadorPerfil('${a.jogador_id}')">
            <b style="width:18px; color:var(--text-muted);">${i + 1}º</b>
            <div class="roster-avatar" style="width:32px; height:32px;">${a.foto_url ? `<img src="${a.foto_url}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=''; this.parentElement.innerHTML='🅰️';">` : '🅰️'}</div>
            <div style="flex:1;"><b>${a.nome}</b> <span style="color:var(--text-muted); font-size:0.78rem;">${a.equipe || ''}</span></div>
            <b style="color:var(--gold-bright);">${a.assistencias}</b>
          </div>
        `).join('')}</div>`
      : '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma assistência registrada ainda.</p>';
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger-strong); font-size:0.85rem;">Erro: ${e.message}</p>`;
  }
}

// ---------------------------------------------------------------------
// CHAVES
// ---------------------------------------------------------------------
// A fase eliminatória (Ouro/Prata) só existe depois que a fase de grupos
// termina — ou seja, quando toda partida "de verdade" (não-bye) da
// categoria já está com status FINISHED. Enquanto isso não acontecer, a
// tabela ainda pode mudar de posição a qualquer momento, então exibir um
// chaveamento "provisório" seria enganoso pro torcedor.
function faseClassificatoriaCompleta() {
  const partidasReais = state.matches.filter(m => !m.is_bye);
  if (!partidasReais.length) return false;
  return partidasReais.every(m => m.status === 'FINISHED');
}

function setFase(fase) {
  state.fase = fase;
  document.querySelectorAll('#screen-chaves .pill-toggle:nth-of-type(2) .pill-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`#screen-chaves [data-fase="${fase}"]`).classList.add('active');
  document.getElementById('fase-ouro-content').style.display = fase === 'ouro' ? 'block' : 'none';
  document.getElementById('fase-prata-content').style.display = fase === 'prata' ? 'block' : 'none';
}

function bracketCardHtml(idLabel, t1, t2) {
  return `
    <div class="bracket-card">
      <div class="bracket-card-id">${idLabel}</div>
      <div class="bracket-row"><span class="team-name">${t1 ? t1.name : 'A definir'}</span><span class="team-score">${t1 ? '-' : ''}</span></div>
      <div class="bracket-row"><span class="team-name">${t2 ? t2.name : 'A definir'}</span><span class="team-score">${t2 ? '-' : ''}</span></div>
    </div>
  `;
}

function renderChaves() {
  const qfContainer = document.getElementById('qf-matches');
  if (!qfContainer) return;

  const completa = faseClassificatoriaCompleta();
  document.getElementById('chaves-aguardando').style.display = completa ? 'none' : 'block';
  document.getElementById('chaves-fase-toggle').style.display = completa ? 'flex' : 'none';
  document.getElementById('fase-ouro-content').style.display = completa && state.fase !== 'prata' ? 'block' : 'none';
  document.getElementById('fase-prata-content').style.display = completa && state.fase === 'prata' ? 'block' : 'none';

  if (!completa) {
    const restantes = state.matches.filter(m => !m.is_bye && m.status !== 'FINISHED').length;
    document.getElementById('chaves-aguardando-sub').innerText =
      `O SUMED Ouro e o SUMED Prata só são definidos depois que a fase de grupos terminar. Faltam ${restantes} partida(s) para o encerramento da fase de grupos.`;
    return;
  }

  const standings = calculateStandings();
  const qfPairs = [
    { id: 'Q1', t1: standings[0], t2: standings[7] },
    { id: 'Q2', t1: standings[3], t2: standings[4] },
    { id: 'Q3', t1: standings[1], t2: standings[6] },
    { id: 'Q4', t1: standings[2], t2: standings[5] },
  ];
  qfContainer.innerHTML = qfPairs.map(p => bracketCardHtml(p.id, p.t1, p.t2)).join('');

  document.getElementById('sf-matches').innerHTML = `
    ${bracketCardHtml('S1', null, null)}
    ${bracketCardHtml('S2', null, null)}
  `;

  const prataContainer = document.getElementById('prata-container');
  const prataTeams = standings.slice(8, 12);
  prataContainer.innerHTML = prataTeams.length
    ? `<div class="bracket-stage-label">Classificados</div>` + prataTeams.map((t, i) => bracketCardHtml('P' + (i + 1), t, null)).join('')
    : '<p style="color:var(--text-muted); padding:20px 0; text-align:center;">Classificação ainda em andamento.</p>';
}

// ---------------------------------------------------------------------
// EQUIPES
// ---------------------------------------------------------------------
function renderEquipes() {
  const grid = document.getElementById('teams-grid');
  if (!grid) return;

  grid.innerHTML = state.teams.map(t => `
    <div class="team-tile" onclick="openTeamProfile('${t.id}')">
      <div class="team-tile-shield">${t.escudo_url ? `<img src="${t.escudo_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='🛡️';">` : '🛡️'}</div>
      <div class="team-tile-name">${t.nome}</div>
    </div>
  `).join('') || '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:20px 0;">Nenhuma equipe cadastrada nesta categoria ainda.</p>';
}

async function openTeamProfile(teamId) {
  const t = state.teams.find(x => x.id === teamId);
  if (!t) return;

  switchScreen('team-profile');
  const el = document.getElementById('team-profile-content');
  el.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:30px 0;">Carregando...</p>';

  const teamMatches = state.matches.filter(m => !m.is_bye && (m.equipe_a === teamId || m.equipe_b === teamId) && m.status === 'FINISHED');
  let V = 0, E = 0, D = 0, GP = 0;
  const forma = [];
  teamMatches.sort((a, b) => a.rodada - b.rodada).forEach(m => {
    const isA = m.equipe_a === teamId;
    const meuGol = isA ? m.placar_a : m.placar_b;
    const advGol = isA ? m.placar_b : m.placar_a;
    GP += meuGol;
    if (meuGol > advGol) { V++; forma.push('V'); }
    else if (meuGol < advGol) { D++; forma.push('D'); }
    else { E++; forma.push('E'); }
  });
  const J = teamMatches.length;
  const aproveitamento = J > 0 ? Math.round(((V * 3 + E) / (J * 3)) * 100) : 0;
  const ultimos5 = forma.slice(-5).reverse();

  let cartoesAmarelo = 0, cartoesVermelho = 0;
  try {
    const eventos = await fetchEventos({ equipeId: teamId });
    eventos.forEach(ev => {
      if (ev.tipo === 'cartao_amarelo') cartoesAmarelo++;
      if (ev.tipo === 'cartao_vermelho') cartoesVermelho++;
    });
  } catch (e) { console.error(e); }

  el.innerHTML = `
    <div class="team-header">
       <div class="team-header-shield">
      ${t.escudo_url ? `<img src="${t.escudo_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--surface-high);\\'>🛡️</div>';">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--surface-high);">🛡️</div>'}
      <div class="team-header-name">${t.nome}</div>
      <div class="team-header-tags">
        <span class="team-tag">🧢 Capitão: ${t.capitao}</span>
        <span class="team-tag">🪪 Pres: ${t.presidente}</span>
        ${t.diretor_marketing && t.diretor_marketing !== 'A definir' ? `<span class="team-tag">📣 Marketing: ${t.diretor_marketing}</span>` : ''}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Gols Marcados</div>
        <div class="stat-value">${GP} <small>/ ${J} J</small></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Aproveitamento</div>
        <div class="stat-value">${aproveitamento}% <small>${V}V ${E}E ${D}D</small></div>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <div class="stat-label">Disciplina</div>
      <div class="discipline-card">
        <div class="discipline-item"><span class="chip chip-yellow"></span> ${cartoesAmarelo}</div>
        <div class="discipline-item"><span class="chip chip-red"></span> ${cartoesVermelho}</div>
      </div>
    </div>

    <div class="card">
      <div class="stat-label">Últimos ${ultimos5.length} Jogos</div>
      <div class="form-strip">
        ${ultimos5.map(r => `<div class="form-dot ${r}">${r}</div>`).join('') || '<span style="color:var(--text-muted); font-size:0.85rem;">Sem jogos concluídos ainda.</span>'}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Elenco <span style="color:var(--text-muted); font-weight:400;">${(t.jogadores || []).length} Jogadores</span></div>
      ${(t.jogadores || []).length ? t.jogadores.map(j => `
        <div class="roster-item ${j.nome === t.capitao ? 'captain' : ''}" style="cursor:pointer;" onclick="openJogadorPerfil('${j.id}')">
          <div class="roster-avatar">
            ${j.foto_url ? `<img src="${j.foto_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='${j.posicao === 'Goleiro' || j.posicao === 'G' ? 'G' : ''}';">` : (j.posicao === 'Goleiro' || j.posicao === 'G' ? 'G' : '')}
          </div>
          <div>
            <div class="roster-name">${j.nome} ${j.nome === t.capitao ? '©' : ''}${j.convidado ? ' 👤' : ''}</div>
            <div class="roster-role">${j.posicao || 'Posição não informada'}${j.numero ? ' • #' + j.numero : ''}</div>
          </div>
        </div>
      `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem;">Elenco ainda não cadastrado.</p>'}
    </div>
  `;
}

// ---------------------------------------------------------------------
// CARD FLUTUANTE — PLACAR AO VIVO (com Picture-in-Picture e animações)
// ---------------------------------------------------------------------
let liveChannel = null;
let liveEventsChannel = null;
let livePollInterval = null;
let liveDismissed = false;
let liveWidgetEl = null; // referência fixa — não usar getElementById depois de mover pro PiP
let pipWindow = null;

function getLiveWidgetEl() {
  if (!liveWidgetEl) liveWidgetEl = document.getElementById('live-widget');
  return liveWidgetEl;
}

const PIP_SUPORTADO = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

function renderLiveWidget(m, teamA, teamB) {
  const el = getLiveWidgetEl();
  el.innerHTML = `
    <button class="live-widget-close" onclick="dismissLiveWidget()">✕</button>
    <div class="hero-live-tag"><span class="dot"></span> Ao Vivo</div>
    <div class="live-widget-teams"><span>${teamA?.nome || '?'}</span><span>${teamB?.nome || '?'}</span></div>
    <div class="live-widget-score" id="live-widget-score">${m.placar_a ?? 0} × ${m.placar_b ?? 0}</div>
    <div class="live-widget-actions">
      ${m.link_transmissao ? `<a href="${m.link_transmissao}" target="_blank" rel="noopener" class="live-widget-link">📡 Assistir</a>` : ''}
      ${PIP_SUPORTADO ? `<button class="live-widget-pip" onclick="togglePip()">📌 Flutuar</button>` : ''}
    </div>
  `;
  el.style.display = 'block';
}

function dismissLiveWidget() {
  liveDismissed = true;
  getLiveWidgetEl().style.display = 'none';
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  if (liveEventsChannel) { sb.removeChannel(liveEventsChannel); liveEventsChannel = null; }
  if (pipWindow) { pipWindow.close(); }
}

// Bolinha/cartão sobe e desaparece — dispara em cima do widget, esteja
// ele na página normal ou já flutuando na janela de PiP (mesmo elemento,
// então funciona nos dois casos sem lógica extra).
function spawnFloatingIcon(emoji) {
  if (!emoji) return;
  const el = getLiveWidgetEl();
  const span = document.createElement('span');
  span.className = 'live-float-icon';
  span.textContent = emoji;
  el.appendChild(span);
  setTimeout(() => span.remove(), 1700);
}

async function checkLiveMatch() {
  if (liveDismissed) return;
  try {
    const m = await fetchLiveMatch(state.categoria);
    if (!m) {
      getLiveWidgetEl().style.display = 'none';
      if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
      if (liveEventsChannel) { sb.removeChannel(liveEventsChannel); liveEventsChannel = null; }
      return;
    }

    const teamA = state.teams.find(t => t.id === m.equipe_a);
    const teamB = state.teams.find(t => t.id === m.equipe_b);
    renderLiveWidget(m, teamA, teamB);

    if (!liveChannel) {
      liveChannel = subscribeToMatch(m.id, (updated) => {
        if (updated.status !== 'LIVE') { checkLiveMatch(); return; }
        const scoreEl = getLiveWidgetEl().querySelector('#live-widget-score');
        if (scoreEl) scoreEl.textContent = `${updated.placar_a ?? 0} × ${updated.placar_b ?? 0}`;
      });
    }

    if (!liveEventsChannel) {
      liveEventsChannel = subscribeToMatchEvents(m.id, {
        onGol: () => spawnFloatingIcon('⚽'),
        onCartao: (ev) => spawnFloatingIcon(
          ev.tipo === 'cartao_amarelo' ? '🟨' : ev.tipo === 'cartao_vermelho' ? '🟥' : null
        ),
      });
    }
  } catch (e) { console.error('Erro ao checar partida ao vivo:', e); }
}

function initLiveWidget() {
  checkLiveMatch();
  if (livePollInterval) clearInterval(livePollInterval);
  livePollInterval = setInterval(checkLiveMatch, 20000); // fallback caso o Realtime falhe
}

// ---------------------------------------------------------------------
// PICTURE-IN-PICTURE (Document PiP API — Chrome/Edge desktop e Android)
// ---------------------------------------------------------------------
async function togglePip() {
  if (!PIP_SUPORTADO) {
    alert('Seu navegador não suporta janela flutuante. Funciona no Chrome/Edge (desktop e Android). Safari/iOS não tem essa API — nesses casos o placar fica na aba mesmo.');
    return;
  }

  if (pipWindow) { pipWindow.close(); return; }

  const el = getLiveWidgetEl();
  pipWindow = await documentPictureInPicture.requestWindow({ width: 240, height: 260 });

  // Copia as folhas de estilo da página pra dentro da janela flutuante
  // (ela nasce com um documento em branco, sem CSS nenhum).
  [...document.styleSheets].forEach((styleSheet) => {
    try {
      const cssTexto = [...styleSheet.cssRules].map((r) => r.cssText).join('');
      const style = document.createElement('style');
      style.textContent = cssTexto;
      pipWindow.document.head.appendChild(style);
    } catch (e) {
      if (styleSheet.href) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleSheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  });

  pipWindow.document.body.style.margin = '0';
  pipWindow.document.body.style.background = '#111415';
  el.classList.add('in-pip');
  pipWindow.document.body.appendChild(el);

  pipWindow.addEventListener('pagehide', () => {
    el.classList.remove('in-pip');
    document.body.appendChild(el);
    pipWindow = null;
  });
}

// ---------------------------------------------------------------------
// SELEÇÃO DA RODADA (automático pela nota, com desempate) + ACUMULADO
// ---------------------------------------------------------------------
function statsDoJogadorNaPartida(jogadorId, partidaId, gols, eventos) {
  const golsFeitos = gols.filter(g => g.partida_id === partidaId && g.jogador_id === jogadorId).length;
  const assistencias = gols.filter(g => g.partida_id === partidaId && g.assistencia_jogador_id === jogadorId).length;
  const amarelos = eventos.filter(e => e.partida_id === partidaId && e.jogador_id === jogadorId && e.tipo === 'cartao_amarelo').length;
  const vermelhos = eventos.filter(e => e.partida_id === partidaId && e.jogador_id === jogadorId && e.tipo === 'cartao_vermelho').length;
  return { golsFeitos, assistencias, disciplina: amarelos + vermelhos * 3 }; // disciplina: menor é melhor
}

function golsSofridosNaPartida(e) {
  const p = e.partidas;
  if (!p) return 0;
  const souEquipeA = p.equipe_a === e.equipe_id;
  return souEquipeA ? (p.placar_b ?? 0) : (p.placar_a ?? 0);
}

// Seleção da Rodada / do Campeonato: 1 GOL, 2 FIXO (os dois melhores da
// rodada), 1 ALA, 1 PIVÔ — 5 posições no total.
const VAGAS_POR_POSICAO_SELECAO = { GOL: 1, FIXO: 2, ALA: 1, PIVO: 1 };

// Comparador para ranquear candidatos de uma mesma posição, do melhor pro
// pior: 1) maior nota; havendo empate —
// linha/ataque → 2) gols feitos 3) assistências 4) disciplina (menos cartão)
// goleiro (GOL) → 2) gols sofridos (menos é melhor) 3) disciplina
function compararCandidatosSelecao(a, b, gols, eventos) {
  const notaA = Number(a.nota), notaB = Number(b.nota);
  if (notaB !== notaA) return notaB - notaA;

  const ehGoleiro = a.jogadores?.posicao === 'GOL';
  if (ehGoleiro) {
    const diffSofridos = golsSofridosNaPartida(a) - golsSofridosNaPartida(b);
    if (diffSofridos !== 0) return diffSofridos;
    const dA = statsDoJogadorNaPartida(a.jogador_id, a.partida_id, gols, eventos).disciplina;
    const dB = statsDoJogadorNaPartida(b.jogador_id, b.partida_id, gols, eventos).disciplina;
    return dA - dB;
  }
  const sA = statsDoJogadorNaPartida(a.jogador_id, a.partida_id, gols, eventos);
  const sB = statsDoJogadorNaPartida(b.jogador_id, b.partida_id, gols, eventos);
  if (sB.golsFeitos !== sA.golsFeitos) return sB.golsFeitos - sA.golsFeitos;
  if (sB.assistencias !== sA.assistencias) return sB.assistencias - sA.assistencias;
  return sA.disciplina - sB.disciplina;
}

// Retorna os N melhores de uma posição (N vem de VAGAS_POR_POSICAO_SELECAO),
// um por jogador (se por algum motivo o mesmo atleta tiver mais de uma
// escalação na mesma rodada, fica só a melhor entrada dele).
function melhoresDaPosicao(candidatos, gols, eventos, quantidade) {
  const porJogador = {};
  candidatos.forEach(c => {
    const atual = porJogador[c.jogador_id];
    if (!atual || compararCandidatosSelecao(c, atual, gols, eventos) < 0) porJogador[c.jogador_id] = c;
  });
  return Object.values(porJogador)
    .sort((a, b) => compararCandidatosSelecao(a, b, gols, eventos))
    .slice(0, quantidade);
}

function agruparMelhorPorRodada(escalacoes, gols, eventos) {
  const porRodada = {};
  escalacoes.forEach(e => {
    const rodada = e.partidas?.rodada;
    if (!rodada) return;
    if (!porRodada[rodada]) porRodada[rodada] = [];
    porRodada[rodada].push(e);
  });

  const resultado = {};
  Object.entries(porRodada).forEach(([rodada, entries]) => {
    const porPosicao = {};
    entries.forEach(e => {
      const pos = e.jogadores?.posicao || '—';
      (porPosicao[pos] = porPosicao[pos] || []).push(e);
    });

    // melhorPorPosicao guarda uma LISTA por posição (1 pra GOL/ALA/PIVÔ,
    // 2 pra FIXO), pra manter compatibilidade com quem consome isso é
    // achatado em array antes de render/acumulação.
    const melhorPorPosicao = {};
    Object.entries(porPosicao).forEach(([pos, candidatos]) => {
      const vagas = VAGAS_POR_POSICAO_SELECAO[pos] ?? 1;
      melhorPorPosicao[pos] = melhoresDaPosicao(candidatos, gols, eventos, vagas);
    });
    resultado[rodada] = melhorPorPosicao;
  });
  return resultado;
}

// Achata o objeto { pos: [entradas] } em um array único de entradas,
// pronto pra passar pro pitch (renderPitchSelecao) ou pra acumulação
// da seleção do campeonato.
function achatarSelecao(melhorPorPosicao) {
  return Object.values(melhorPorPosicao).flat();
}

async function getDadosSelecaoCategoria() {
  if (!state._selecaoCache) {
    const [escalacoes, gols, eventos] = await Promise.all([
      fetchEscalacoesDaCategoria(state.categoria),
      fetchGolsDaCategoria(state.categoria),
      fetchEventosDaCategoria(state.categoria),
    ]);
    state._selecaoCache = { escalacoes, gols, eventos };
  }
  return state._selecaoCache;
}

function iconesSelecao(jid, pid, gols, eventos) {
  const golsMarcados = gols.filter(g => g.partida_id === pid && g.jogador_id === jid).length;
  const assistencias = gols.filter(g => g.partida_id === pid && g.assistencia_jogador_id === jid).length;
  const cartoes = eventos.filter(e => e.partida_id === pid && e.jogador_id === jid);
  let out = '';
  cartoes.forEach(c => { if (TIPO_EVENTO_LABEL_PUBLICO[c.tipo]) out += `<span>${TIPO_EVENTO_LABEL_PUBLICO[c.tipo]}</span>`; });
  if (golsMarcados) out += `<span>⚽${golsMarcados > 1 ? 'x' + golsMarcados : ''}</span>`;
  if (assistencias) out += `<span>🅰️${assistencias > 1 ? 'x' + assistencias : ''}</span>`;
  return out;
}

function renderPitchSelecao(entradas, gols, eventos) {
  const linhas = agruparEscalacaoPorLinha(entradas);
  const iconesFn = (jid, pid) => iconesSelecao(jid, pid, gols, eventos);
  return `
    <div class="pitch">
      <div class="pitch-goal-box top"></div>
      ${[4, 3, 2, 1, 0].filter(n => linhas[n].length).map(n => `<div class="pitch-line">${linhas[n].map(e => renderPitchPlayer(e, iconesFn, true)).join('')}</div>`).join('')}
      <div class="pitch-goal-box bottom"></div>
    </div>
  `;
}

async function renderSelecaoRodada() {
  const elSelecao = document.getElementById('selecao-rodada');
  if (!elSelecao) return;
  elSelecao.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Carregando...</p>';

  try {
    const { escalacoes, gols, eventos } = await getDadosSelecaoCategoria();
    const agrupado = agruparMelhorPorRodada(escalacoes, gols, eventos);
    const melhorPorPosicao = agrupado[state.selectedRound];

    if (!melhorPorPosicao || !Object.keys(melhorPorPosicao).length) {
      elSelecao.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Sem notas lançadas nesta rodada ainda.</p>';
      return;
    }

    elSelecao.innerHTML = renderPitchSelecao(achatarSelecao(melhorPorPosicao), gols, eventos);
  } catch (e) {
    console.error(e);
    elSelecao.innerHTML = '';
  }
}

function calcularMelhorDoCampeonatoPorPosicao(agrupadoPorRodada) {
  const acumulado = {}; // posicao -> jogadorId -> { entry, pontos, somaNotas, qtdNotas }
  Object.values(agrupadoPorRodada).forEach(melhorPorPosicao => {
    Object.entries(melhorPorPosicao).forEach(([pos, entradas]) => {
      acumulado[pos] = acumulado[pos] || {};
      entradas.forEach(e => {
        const id = e.jogador_id;
        if (!acumulado[pos][id]) acumulado[pos][id] = { entry: e, pontos: 0, somaNotas: 0, qtdNotas: 0 };
        acumulado[pos][id].pontos++;
        acumulado[pos][id].somaNotas += Number(e.nota);
        acumulado[pos][id].qtdNotas++;
      });
    });
  });

  const melhorPorPosicao = {};
  Object.entries(acumulado).forEach(([pos, candidatosObj]) => {
    const vagas = VAGAS_POR_POSICAO_SELECAO[pos] ?? 1;
    const candidatos = Object.values(candidatosObj).sort((a, b) => {
      if (b.pontos !== a.pontos) return b.pontos - a.pontos;
      return (b.somaNotas / b.qtdNotas) - (a.somaNotas / a.qtdNotas);
    });
    melhorPorPosicao[pos] = candidatos.slice(0, vagas).map(melhor => ({
      ...melhor.entry, nota: (melhor.somaNotas / melhor.qtdNotas).toFixed(1), _pontos: melhor.pontos,
    }));
  });
  return melhorPorPosicao;
}

async function openSelecaoCampeonato() {
  document.getElementById('modal-title').innerText = '🏅 Seleção do Campeonato';
  document.getElementById('modal-body').innerHTML = '<p style="color:var(--text-muted);">Calculando acumulado da temporada...</p>';
  document.getElementById('app-modal').classList.add('active');

  try {
    const { escalacoes, gols, eventos } = await getDadosSelecaoCategoria();
    const agrupado = agruparMelhorPorRodada(escalacoes, gols, eventos);
    const melhorPorPosicao = calcularMelhorDoCampeonatoPorPosicao(agrupado);

    if (!Object.keys(melhorPorPosicao).length) {
      document.getElementById('modal-body').innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px 0;">Sem dados suficientes ainda.</p>';
      return;
    }

    const legendaHtml = Object.entries(melhorPorPosicao).flatMap(([pos, entradas]) => entradas.map(e => `
      <div style="display:flex; justify-content:space-between; padding:5px 0; border-top:1px solid var(--border-soft); font-size:0.82rem;">
        <span><b>${e.jogadores?.nome}</b> <span style="color:var(--text-muted);">${pos} · ${e.equipes?.nome || ''}</span></span>
        <b style="color:var(--gold-bright);">${e._pontos}× seleção</b>
      </div>
    `)).join('');

    document.getElementById('modal-body').innerHTML = `
      ${renderPitchSelecao(achatarSelecao(melhorPorPosicao), gols, eventos)}
      <div class="card" style="margin-top:12px;">
        <div class="card-title">Quantas vezes cada um foi convocado</div>
        ${legendaHtml}
      </div>
    `;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<p style="color:var(--danger-strong);">Erro: ${e.message}</p>`;
  }
}

// ---------------------------------------------------------------------
// SÚMULA / REGULAMENTO (modal)
// ---------------------------------------------------------------------
async function openSumula(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;

  const teamA = state.teams.find(t => t.id === m.equipe_a)?.nome;
  const teamB = state.teams.find(t => t.id === m.equipe_b)?.nome;
  const extras = m.teve_prorrogacao ? ' <small style="color:var(--gold);">(após prorrogação)</small>' : '';

  document.getElementById('modal-title').innerText = 'Súmula de Jogo';
  document.getElementById('modal-body').innerHTML = `
    <div style="text-align:center; margin-bottom:15px;">
      <h3>${teamA} ${m.placar_a ?? '-'} × ${m.placar_b ?? '-'} ${teamB}${extras}</h3>
      <small style="color:var(--text-muted);">${m.data ? formatDate(m.data) : ''} • ${m.local || ''}</small>
    </div>
    <div id="sumula-penaltis"></div>
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">⚽ Gols & Assistências</div>
      <div id="sumula-gols"><p style="font-size:0.85rem; color:var(--text-muted);">Carregando...</p></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">Ocorrências</div>
      <div id="sumula-eventos"><p style="font-size:0.85rem; color:var(--text-muted);">Carregando...</p></div>
    </div>
  `;
  document.getElementById('app-modal').classList.add('active');

  try {
    const [gols, eventos, penaltis] = await Promise.all([
      fetchGols(matchId),
      fetchEventos({ partidaId: matchId }),
      m.teve_penaltis ? fetchPenaltis(matchId) : Promise.resolve([]),
    ]);

    document.getElementById('sumula-gols').innerHTML = gols.length
      ? gols.map(g => `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">⚽ <b style="color:var(--text);">${g.marcador?.nome || ''}</b>${g.assistente?.nome ? ` <span style="color:var(--gold);">(assist: ${g.assistente.nome})</span>` : ''} (${g.equipes?.nome || ''})${g.minuto ? ` — ${g.minuto}'` : ''}${g.tipo === 'prorrogacao' ? ' · Prorrogação' : ''}</p>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">Nenhum gol registrado.</p>';

    document.getElementById('sumula-eventos').innerHTML = eventos.length
      ? eventos.map(ev => `
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">
            ${TIPO_EVENTO_LABEL_PUBLICO[ev.tipo] || '📌'} <b style="color:var(--text);">${ev.jogadores?.nome || ''}</b>
            (${ev.equipes?.nome || ''})${ev.minuto ? ` — ${ev.minuto}'` : ''}${ev.descricao ? ` · ${ev.descricao}` : ''}
          </p>
        `).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">Nenhuma ocorrência gravada em súmula.</p>';

    if (m.teve_penaltis && penaltis.length) {
      const golsA = penaltis.filter(p => p.equipe_id === m.equipe_a && p.convertido).length;
      const golsB = penaltis.filter(p => p.equipe_id === m.equipe_b && p.convertido).length;
      document.getElementById('sumula-penaltis').innerHTML = `
        <div class="card" style="text-align:center;">
          <div class="card-title">Disputa de Pênaltis</div>
          <div style="font-size:1.4rem; font-weight:800; color:var(--gold-bright);">${golsA} (${penaltis.filter(p => p.equipe_id === m.equipe_a).length}) × (${penaltis.filter(p => p.equipe_id === m.equipe_b).length}) ${golsB}</div>
          <div style="display:flex; justify-content:center; gap:6px; margin-top:10px; flex-wrap:wrap;">
            ${penaltis.map(p => `<span title="${p.jogadores?.nome}" style="font-size:1.1rem;">${p.convertido ? '✅' : '❌'}</span>`).join('')}
          </div>
        </div>
      `;
    }
  } catch (e) { console.error(e); }
}

const LINHA_POSICAO = {
  GOL: 0,
  LE: 1, ZAG: 1, LD: 1, FIXO: 1,
  ME: 2, MC: 2, MD: 2, ALA: 2,
  PE: 3, PD: 3,
  CA: 4, PIVO: 4,
};
const ORDEM_NA_LINHA = { LE: 0, ZAG: 1, LD: 2, FIXO: 0, ME: 0, MC: 1, MD: 2, ALA: 0, PE: 0, PD: 1, CA: 0, PIVO: 0 };

function agruparEscalacaoPorLinha(titulares) {
  const linhas = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  titulares.forEach(e => {
    const pos = e.jogadores?.posicao || '';
    const linha = LINHA_POSICAO[pos] !== undefined ? LINHA_POSICAO[pos] : 2;
    linhas[linha].push(e);
  });
  Object.values(linhas).forEach(l => l.sort((a, b) => (ORDEM_NA_LINHA[a.jogadores?.posicao] ?? 9) - (ORDEM_NA_LINHA[b.jogadores?.posicao] ?? 9)));
  return linhas;
}

function formacaoLabel(linhas) {
  const defesa = linhas[1].length;
  const meio = linhas[2].length + linhas[3].length;
  const ataque = linhas[4].length;
  return [defesa, meio, ataque].filter(n => n > 0).join('-') || '—';
}

function renderPitchPlayer(e, icones, mostrarEquipe) {
  const j = e.jogadores || {};
  return `
    <div class="pitch-player" onclick="openJogadorPerfil('${e.jogador_id}')">
      <div class="pitch-player-badges">${icones(e.jogador_id, e.partida_id)}</div>
      <div class="pitch-player-avatar">${j.foto_url ? `<img src="${j.foto_url}">` : (j.numero || '')}</div>
      ${e.nota !== null ? `<div class="pitch-player-nota">${Number(e.nota).toFixed(1)}</div>` : ''}
      <div class="pitch-player-name">${j.nome ? j.nome.split(' ')[0] : ''}${j.convidado ? ' 👤' : ''}</div>
      ${mostrarEquipe ? `<div class="pitch-player-team">${e.equipes?.nome || ''}</div>` : ''}
    </div>
  `;
}

function renderReservasBloco(t, escalacaoDoTime, icones) {
  const reservas = escalacaoDoTime.filter(e => !e.titular);
  if (!reservas.length) return '';
  return `
    <div class="pitch-reserves">
      <div class="pitch-reserves-label">Reservas — ${t?.nome || ''}</div>
      ${reservas.map(e => `
        <div class="roster-item" style="cursor:pointer; margin-bottom:6px;" onclick="openJogadorPerfil('${e.jogador_id}')">
          <div class="roster-avatar">${e.jogadores?.foto_url ? `<img src="${e.jogadores.foto_url}">` : (e.jogadores?.numero || '')}</div>
          <div style="flex:1;">
            <div class="roster-name">${e.jogadores?.nome || ''}${e.jogadores?.convidado ? ' 👤' : ''}</div>
            <div class="roster-role">${e.jogadores?.posicao || ''} ${icones(e.jogador_id)}</div>
          </div>
          ${e.nota !== null ? `<b style="color:var(--gold-bright);">${Number(e.nota).toFixed(1)}</b>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// Campo único com as duas equipes — time A de cima (goleiro no topo, ataque
// perto do centro), time B espelhado embaixo (ataque perto do centro,
// goleiro na base). É como jogos de futebol mostram escalação de confronto.
function renderEscalacaoMesclada(tA, tB, escalacaoA, escalacaoB, icones) {
  const titularesA = escalacaoA.filter(e => e.titular);
  const titularesB = escalacaoB.filter(e => e.titular);
  const linhasA = agruparEscalacaoPorLinha(titularesA);
  const linhasB = agruparEscalacaoPorLinha(titularesB);

  const metadeA = titularesA.length
    ? [0, 1, 2, 3, 4].filter(n => linhasA[n].length).map(n => `<div class="pitch-line">${linhasA[n].map(e => renderPitchPlayer(e, icones)).join('')}</div>`).join('')
    : `<p class="pitch-empty-msg">Escalação de ${tA?.nome || 'equipe A'} pendente</p>`;

  const metadeB = titularesB.length
    ? [4, 3, 2, 1, 0].filter(n => linhasB[n].length).map(n => `<div class="pitch-line">${linhasB[n].map(e => renderPitchPlayer(e, icones)).join('')}</div>`).join('')
    : `<p class="pitch-empty-msg">Escalação de ${tB?.nome || 'equipe B'} pendente</p>`;

  return `
    <div class="pitch-formation-label">
      <span onclick="irParaEquipe('${tA?.id}')" style="cursor:pointer; text-decoration:underline dotted;">${tA?.nome || ''} · ${formacaoLabel(linhasA)}</span>
      &nbsp;×&nbsp;
      <span onclick="irParaEquipe('${tB?.id}')" style="cursor:pointer; text-decoration:underline dotted;">${tB?.nome || ''} · ${formacaoLabel(linhasB)}</span>
    </div>
    <div class="pitch pitch-dual">
      <div class="pitch-goal-box top"></div>
      ${metadeA}
      <div class="pitch-center-line"></div>
      ${metadeB}
      <div class="pitch-goal-box bottom"></div>
    </div>
    ${renderReservasBloco(tA, escalacaoA, icones)}
    ${renderReservasBloco(tB, escalacaoB, icones)}
  `;
}

function irParaEquipe(teamId) {
  closeModal();
  openTeamProfile(teamId);
}

async function openEscalacoes(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  const tA = state.teams.find(t => t.id === m.equipe_a);
  const tB = state.teams.find(t => t.id === m.equipe_b);

  document.getElementById('modal-title').innerText = 'Escalações';
  document.getElementById('modal-body').innerHTML = '<p style="color:var(--text-muted);">Carregando...</p>';
  document.getElementById('app-modal').classList.add('active');

  try {
    const [escalacao, eventos, gols] = await Promise.all([
      fetchEscalacao(matchId),
      fetchEventos({ partidaId: matchId }),
      fetchGols(matchId),
    ]);

    const icones = (jogadorId) => {
      const cartoes = eventos.filter(e => e.jogador_id === jogadorId);
      const golsMarcados = gols.filter(g => g.jogador_id === jogadorId).length;
      const assistencias = gols.filter(g => g.assistencia_jogador_id === jogadorId).length;
      let out = '';
      cartoes.forEach(c => { if (TIPO_EVENTO_LABEL_PUBLICO[c.tipo]) out += `<span>${TIPO_EVENTO_LABEL_PUBLICO[c.tipo]}</span>`; });
      if (golsMarcados) out += `<span>⚽${golsMarcados > 1 ? 'x' + golsMarcados : ''}</span>`;
      if (assistencias) out += `<span>🅰️${assistencias > 1 ? 'x' + assistencias : ''}</span>`;
      return out;
    };

    const escalacaoA = escalacao.filter(e => e.equipe_id === tA?.id);
    const escalacaoB = escalacao.filter(e => e.equipe_id === tB?.id);

    document.getElementById('modal-body').innerHTML = renderEscalacaoMesclada(tA, tB, escalacaoA, escalacaoB, icones);
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<p style="color:var(--danger-strong);">Erro ao carregar: ${e.message}</p>`;
  }
}

// ---------------------------------------------------------------------
// PERFIL DO JOGADOR (modal com estatísticas)
// ---------------------------------------------------------------------
async function openJogadorPerfil(jogadorId) {
  let jogador = null;
  let equipe = null;
  state.teams.forEach(t => {
    const encontrado = (t.jogadores || []).find(j => j.id === jogadorId);
    if (encontrado) { jogador = encontrado; equipe = t; }
  });
  if (!jogador) return;

  document.getElementById('modal-title').innerText = jogador.nome;
  document.getElementById('modal-body').innerHTML = `
    <div style="text-align:center; margin-bottom:16px;">
    <div class="team-header-shield" style="border-radius:50%; margin:0 auto 10px;">
      ${jogador.foto_url ? `<img src="${jogador.foto_url}" loading="lazy" decoding="async" onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:var(--surface-high);\\'>👤</div>';">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.8rem;background:var(--surface-high);">👤</div>'}
      <h4>${jogador.nome} ${jogador.convidado ? '👤' : ''}</h4>
      <p style="color:var(--text-muted); font-size:0.85rem; margin-top:4px; cursor:pointer;" onclick="irParaEquipe('${equipe?.id}')">${equipe?.nome || ''} <span style="text-decoration:underline;">→</span></p>
      <p style="color:var(--gold); font-size:0.8rem; margin-top:2px;">${jogador.posicao || 'Posição não informada'}${jogador.numero ? ' · #' + jogador.numero : ''}</p>
    </div>
    <div id="jogador-perfil-stats"><p style="text-align:center; color:var(--text-muted); font-size:0.85rem;">Carregando estatísticas...</p></div>
  `;
  document.getElementById('app-modal').classList.add('active');

  try {
    const stats = await fetchJogadorStats(jogadorId);
    document.getElementById('jogador-perfil-stats').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Gols</div><div class="stat-value">${stats.gols}</div></div>
        <div class="stat-card"><div class="stat-label">Assistências</div><div class="stat-value">${stats.assistencias}</div></div>
      </div>
      <div class="card" style="margin-top:12px;">
        <div class="stat-label">Disciplina</div>
        <div class="discipline-card">
          <div class="discipline-item"><span class="chip chip-yellow"></span> ${stats.cartaoAmarelo}</div>
          <div class="discipline-item"><span class="chip chip-red"></span> ${stats.cartaoVermelho}</div>
          <div class="discipline-item">🩹 ${stats.lesoes}</div>
        </div>
      </div>
      <div class="card">
        <div class="stat-label">Média de Nota Acumulada</div>
        <div class="stat-value" style="margin-top:6px;">${stats.mediaNota !== null ? stats.mediaNota.toFixed(1) : '—'} ${stats.jogosAvaliados ? `<small>(${stats.jogosAvaliados} jogo${stats.jogosAvaliados > 1 ? 's' : ''} avaliado${stats.jogosAvaliados > 1 ? 's' : ''})</small>` : ''}</div>
      </div>
    `;
  } catch (e) {
    document.getElementById('jogador-perfil-stats').innerHTML = `<p style="color:var(--danger-strong); font-size:0.85rem;">Erro ao carregar estatísticas: ${e.message}</p>`;
  }
}

async function openRegulamento() {
  document.getElementById('modal-title').innerText = 'Regulamento Oficial';
  document.getElementById('modal-body').innerHTML = '<p style="color:var(--text-muted);">Carregando...</p>';
  document.getElementById('app-modal').classList.add('active');
  try {
    const reg = await fetchConfig('regulamento', REGULAMENTO_PADRAO);
    document.getElementById('modal-body').innerHTML = `<div style="line-height:1.6; color:var(--text-muted); font-size:0.9rem;">${reg}</div>`;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<div style="line-height:1.6; color:var(--text-muted); font-size:0.9rem;">${REGULAMENTO_PADRAO}</div>`;
  }
}

function closeModal() {
  document.getElementById('app-modal').classList.remove('active');
}

// ---------------------------------------------------------------------
// PATROCINADORES
// ---------------------------------------------------------------------
async function renderSponsors() {
  const container = document.getElementById('sponsors-block');
  if (!container) return;
  try {
    const sponsors = await fetchSponsors();
    if (!sponsors.length) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <p class="section-label" style="font-size:1rem;">Patrocinadores</p>
      <div class="sponsors-row">
        ${sponsors.map(s => `
          <a href="${s.link || '#'}" target="_blank" rel="noopener" class="sponsor-card" title="${s.nome}">
            <img src="${s.logo_url}" alt="${s.nome}">
          </a>
        `).join('')}
      </div>
    `;
  } catch (e) { console.error('Erro ao carregar patrocinadores:', e); }
}

// ---------------------------------------------------------------------
// RENDER GERAL / INIT
// ---------------------------------------------------------------------
function renderAll() {
  renderHero();
  renderRodadas();
  renderSelecaoRodada();
  renderTabela();
  renderChaves();
  renderEquipes();
}

document.addEventListener('DOMContentLoaded', async () => {
  loadIdentidadeVisual(); // roda em paralelo, cedo — não bloqueia o resto
  renderCategoriaToggles();

  try {
    await loadData();
  } catch (e) {
    console.error('Erro ao carregar dados públicos:', e);
  }

  renderAll();
  renderSponsors();
  initLiveWidget();
  setTimeout(maybeShowInstallBanner, 2500); // dá tempo do usuário ver o app antes de pedir instalação

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocalDev) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
