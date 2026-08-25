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
  <p>Critérios em ordem: 1º Nº de Vitórias, 2º Gols Marcados (GP), 3º Saldo de Gols (SG), 4º Confronto Direto.</p>
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
};

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
  state._escalacoesCache = null;
  liveDismissed = false;
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  renderCategoriaToggles();
  await loadData();
  renderAll();
  checkLiveMatch();
}

// ---------------------------------------------------------------------
// CARGA DE DADOS
// ---------------------------------------------------------------------
async function loadData() {
  [state.teams, state.matches] = await Promise.all([
    fetchTeams(state.categoria),
    fetchMatches(state.categoria),
  ]);
}

function calculateStandings() {
  const stats = {};
  state.teams.forEach(t => { stats[t.id] = { id: t.id, name: t.nome, P: 0, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0, SG: 0 }; });

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

  Object.values(stats).forEach(t => t.SG = t.GP - t.GC);
  return Object.values(stats).sort((a, b) => {
    if (b.P !== a.P) return b.P - a.P;
    if (b.V !== a.V) return b.V - a.V;
    if (b.GP !== a.GP) return b.GP - a.GP;
    if (b.SG !== a.SG) return b.SG - a.SG;
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
            <div class="hero-shield">${teamA?.escudo_url ? `<img src="${teamA.escudo_url}">` : '⚽'}</div>
            <div class="hero-team-name">${teamA?.nome || 'A definir'}</div>
          </div>
          <div class="hero-team">
            <div class="hero-shield">${teamB?.escudo_url ? `<img src="${teamB.escudo_url}">` : '🏁'}</div>
            <div class="hero-team-name">${teamB?.nome || 'A definir'}</div>
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
    const teamA = state.teams.find(t => t.id === m.equipe_a)?.nome || 'Time A';
    const teamB = state.teams.find(t => t.id === m.equipe_b)?.nome || 'Time B';
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
          <div class="team-box">${teamA}</div>
          <div class="score">${scoreA} × ${scoreB}${extras}${penaltis}</div>
          <div class="team-box away">${teamB}</div>
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
      linhas.push(gols.map(g => `⚽ ${g.jogadores?.nome}${g.minuto ? " " + g.minuto + "'" : ''}${g.tipo === 'prorrogacao' ? ' (PRO)' : ''}`).join(' · '));
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

  tbody.innerHTML = standings.map((t, index) => {
    const pos = index + 1;
    let zoneClass = 'zone-elim';
    if (pos <= 8) zoneClass = 'zone-ouro';
    else if (pos <= 12) zoneClass = 'zone-prata';

    return `
      <tr class="${zoneClass}">
        <td class="pos-cell">${pos}º</td>
        <td>${t.name}</td>
        <td class="pts-cell">${t.P}</td>
        <td>${t.J}</td>
        <td>${t.V}</td>
        <td>${t.SG > 0 ? '+' : ''}${t.SG}</td>
      </tr>
    `;
  }).join('');
}

// ---------------------------------------------------------------------
// CHAVES
// ---------------------------------------------------------------------
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
  const standings = calculateStandings();
  const qfContainer = document.getElementById('qf-matches');
  if (!qfContainer) return;

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
      <div class="team-tile-shield">${t.escudo_url ? `<img src="${t.escudo_url}">` : '🛡️'}</div>
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
      <div class="team-header-shield">${t.escudo_url ? `<img src="${t.escudo_url}">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--surface-high);">🛡️</div>'}</div>
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
        <div class="roster-item ${j.nome === t.capitao ? 'captain' : ''}">
          <div class="roster-avatar">${j.foto_url ? `<img src="${j.foto_url}">` : (j.posicao === 'Goleiro' || j.posicao === 'G' ? 'G' : '')}</div>
          <div>
            <div class="roster-name">${j.nome} ${j.nome === t.capitao ? '⭐' : ''}</div>
            <div class="roster-role">${j.posicao || 'Posição não informada'}${j.numero ? ' • #' + j.numero : ''}</div>
          </div>
        </div>
      `).join('') : '<p style="color:var(--text-muted); font-size:0.85rem;">Elenco ainda não cadastrado.</p>'}
    </div>
  `;
}

// ---------------------------------------------------------------------
// CARD FLUTUANTE — PLACAR AO VIVO
// ---------------------------------------------------------------------
let liveChannel = null;
let livePollInterval = null;
let liveDismissed = false;

function renderLiveWidget(m, teamA, teamB) {
  const el = document.getElementById('live-widget');
  el.innerHTML = `
    <button class="live-widget-close" onclick="dismissLiveWidget()">✕</button>
    <div class="hero-live-tag"><span class="dot"></span> Ao Vivo</div>
    <div class="live-widget-teams"><span>${teamA?.nome || '?'}</span><span>${teamB?.nome || '?'}</span></div>
    <div class="live-widget-score" id="live-widget-score">${m.placar_a ?? 0} × ${m.placar_b ?? 0}</div>
    ${m.link_transmissao ? `<a href="${m.link_transmissao}" target="_blank" rel="noopener" class="live-widget-link">📡 Assistir Ao Vivo</a>` : ''}
  `;
  el.style.display = 'block';
}

function dismissLiveWidget() {
  liveDismissed = true;
  document.getElementById('live-widget').style.display = 'none';
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
}

async function checkLiveMatch() {
  if (liveDismissed) return;
  try {
    const m = await fetchLiveMatch(state.categoria);
    if (!m) {
      document.getElementById('live-widget').style.display = 'none';
      if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
      return;
    }

    const teamA = state.teams.find(t => t.id === m.equipe_a);
    const teamB = state.teams.find(t => t.id === m.equipe_b);
    renderLiveWidget(m, teamA, teamB);

    if (!liveChannel) {
      liveChannel = subscribeToMatch(m.id, (updated) => {
        if (updated.status !== 'LIVE') { checkLiveMatch(); return; }
        const scoreEl = document.getElementById('live-widget-score');
        if (scoreEl) scoreEl.textContent = `${updated.placar_a ?? 0} × ${updated.placar_b ?? 0}`;
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
// SELEÇÃO DA RODADA / PERNAS DE PAU (automático pela nota) + ACUMULADO
// ---------------------------------------------------------------------
function agruparMelhorPiorPorRodada(escalacoes) {
  const porRodada = {};
  escalacoes.forEach(e => {
    const rodada = e.partidas?.rodada;
    if (!rodada) return;
    if (!porRodada[rodada]) porRodada[rodada] = [];
    porRodada[rodada].push(e);
  });

  const resultado = {};
  Object.entries(porRodada).forEach(([rodada, entries]) => {
    const melhorPorPosicao = {};
    entries.forEach(e => {
      const pos = e.jogadores?.posicao || '—';
      if (!melhorPorPosicao[pos] || Number(e.nota) > Number(melhorPorPosicao[pos].nota)) melhorPorPosicao[pos] = e;
    });
    const pior = entries.reduce((min, e) => (!min || Number(e.nota) < Number(min.nota)) ? e : min, null);
    resultado[rodada] = { melhorPorPosicao, pior };
  });
  return resultado;
}

async function getEscalacoesCategoria() {
  if (!state._escalacoesCache) {
    state._escalacoesCache = await fetchEscalacoesDaCategoria(state.categoria);
  }
  return state._escalacoesCache;
}

async function renderSelecaoRodada() {
  const elSelecao = document.getElementById('selecao-rodada');
  const elPernas = document.getElementById('pernas-pau-rodada');
  if (!elSelecao) return;
  elSelecao.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; font-size:0.85rem;">Carregando...</p>';

  try {
    const escalacoes = await getEscalacoesCategoria();
    const agrupado = agruparMelhorPiorPorRodada(escalacoes);
    const dados = agrupado[state.selectedRound];

    if (!dados || !Object.keys(dados.melhorPorPosicao).length) {
      elSelecao.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; font-size:0.85rem;">Sem notas lançadas nesta rodada ainda.</p>';
      elPernas.innerHTML = '';
      return;
    }

    elSelecao.innerHTML = Object.entries(dados.melhorPorPosicao).map(([pos, e]) => `
      <div class="team-tile" style="cursor:default;">
        <div class="team-tile-shield" style="border-radius:50%;">${e.jogadores?.foto_url ? `<img src="${e.jogadores.foto_url}">` : '👤'}</div>
        <div class="team-tile-name">${e.jogadores?.nome}</div>
        <div style="font-size:0.72rem; color:var(--text-muted);">${pos}</div>
        <div style="color:var(--gold-bright); font-weight:800;">${Number(e.nota).toFixed(1)}</div>
      </div>
    `).join('');

    elPernas.innerHTML = dados.pior ? `
      <div class="card" style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:1.6rem;">🪵</div>
        <div style="flex:1;">
          <b>${dados.pior.jogadores?.nome}</b>
          <p style="font-size:0.8rem; color:var(--text-muted);">${dados.pior.jogadores?.posicao || ''} · ${dados.pior.equipes?.nome || ''}</p>
        </div>
        <div style="color:var(--danger-strong); font-weight:800; font-size:1.2rem;">${Number(dados.pior.nota).toFixed(1)}</div>
      </div>
    ` : '';
  } catch (e) {
    console.error(e);
    elSelecao.innerHTML = '';
  }
}

async function openSelecaoCampeonato() {
  document.getElementById('modal-title').innerText = '🏅 Seleção do Campeonato';
  document.getElementById('modal-body').innerHTML = '<p style="color:var(--text-muted);">Calculando acumulado da temporada...</p>';
  document.getElementById('app-modal').classList.add('active');

  try {
    const escalacoes = await getEscalacoesCategoria();
    const agrupado = agruparMelhorPiorPorRodada(escalacoes);

    const pontosMelhor = {}; // jogadorId -> { jogador, pontos }
    const pontosPior = {};

    Object.values(agrupado).forEach(({ melhorPorPosicao, pior }) => {
      Object.values(melhorPorPosicao).forEach(e => {
        const id = e.jogador_id;
        if (!pontosMelhor[id]) pontosMelhor[id] = { nome: e.jogadores?.nome, posicao: e.jogadores?.posicao, equipe: e.equipes?.nome, pontos: 0 };
        pontosMelhor[id].pontos++;
      });
      if (pior) {
        const id = pior.jogador_id;
        if (!pontosPior[id]) pontosPior[id] = { nome: pior.jogadores?.nome, posicao: pior.jogadores?.posicao, equipe: pior.equipes?.nome, pontos: 0 };
        pontosPior[id].pontos++;
      }
    });

    const rankMelhor = Object.values(pontosMelhor).sort((a, b) => b.pontos - a.pontos).slice(0, 12);
    const rankPior = Object.values(pontosPior).sort((a, b) => b.pontos - a.pontos).slice(0, 5);

    const linha = (r, cor) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-top:1px solid var(--border-soft); font-size:0.85rem;">
        <span><b>${r.nome}</b> <span style="color:var(--text-muted); font-size:0.75rem;">${r.posicao || ''} · ${r.equipe || ''}</span></span>
        <b style="color:${cor};">${r.pontos}×</b>
      </div>
    `;

    document.getElementById('modal-body').innerHTML = `
      <div class="card">
        <div class="card-title">⭐ Mais vezes na Seleção da Rodada</div>
        ${rankMelhor.map(r => linha(r, 'var(--gold-bright)')).join('') || '<p style="color:var(--text-muted); font-size:0.85rem;">Sem dados ainda.</p>'}
      </div>
      <div class="card">
        <div class="card-title">🪵 Mais vezes Pernas de Pau</div>
        ${rankPior.map(r => linha(r, 'var(--danger-strong)')).join('') || '<p style="color:var(--text-muted); font-size:0.85rem;">Sem dados ainda.</p>'}
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
      <div class="card-title" style="margin-bottom:8px;">⚽ Gols</div>
      <div id="sumula-gols"><p style="font-size:0.85rem; color:var(--text-muted);">Carregando...</p></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">🔄 Substituições</div>
      <div id="sumula-subs"><p style="font-size:0.85rem; color:var(--text-muted);">Carregando...</p></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">Ocorrências</div>
      <div id="sumula-eventos"><p style="font-size:0.85rem; color:var(--text-muted);">Carregando...</p></div>
    </div>
  `;
  document.getElementById('app-modal').classList.add('active');

  try {
    const [gols, subs, eventos, penaltis] = await Promise.all([
      fetchGols(matchId),
      fetchSubstituicoes(matchId),
      fetchEventos({ partidaId: matchId }),
      m.teve_penaltis ? fetchPenaltis(matchId) : Promise.resolve([]),
    ]);

    document.getElementById('sumula-gols').innerHTML = gols.length
      ? gols.map(g => `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">⚽ <b style="color:var(--text);">${g.jogadores?.nome || ''}</b> (${g.equipes?.nome || ''})${g.minuto ? ` — ${g.minuto}'` : ''}${g.tipo === 'prorrogacao' ? ' · Prorrogação' : ''}</p>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">Nenhum gol registrado.</p>';

    document.getElementById('sumula-subs').innerHTML = subs.length
      ? subs.map(s => `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">🔄 <b style="color:var(--text);">${s.entra?.nome || ''}</b> ⬆️ / ${s.saiu?.nome || ''} ⬇️ (${s.equipes?.nome || ''})${s.minuto ? ` — ${s.minuto}'` : ''}</p>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">Nenhuma substituição registrada.</p>';

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

const LINHA_POSICAO = { GOL: 0, LE: 1, ZAG: 1, LD: 1, ME: 2, MC: 2, MD: 2, PE: 3, PD: 3, CA: 4 };
const ORDEM_NA_LINHA = { LE: 0, ZAG: 1, LD: 2, ME: 0, MC: 1, MD: 2, PE: 0, PD: 1, CA: 0 };

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

function renderPitchPlayer(e, icones) {
  const j = e.jogadores || {};
  return `
    <div class="pitch-player">
      <div class="pitch-player-badges">${icones(e.jogador_id)}</div>
      <div class="pitch-player-avatar">${j.foto_url ? `<img src="${j.foto_url}">` : (j.numero || '')}</div>
      ${e.nota !== null ? `<div class="pitch-player-nota">${Number(e.nota).toFixed(1)}</div>` : ''}
      <div class="pitch-player-name">${j.nome ? j.nome.split(' ')[0] : ''}</div>
    </div>
  `;
}

function renderPitchTeam(t, escalacaoDoTime, icones) {
  const titulares = escalacaoDoTime.filter(e => e.titular);
  const reservas = escalacaoDoTime.filter(e => !e.titular);

  if (!titulares.length) {
    return `<div class="card"><div class="card-title">${t?.nome || ''}</div><p style="color:var(--text-muted); font-size:0.85rem;">Escalação ainda não informada.</p></div>`;
  }

  const linhas = agruparEscalacaoPorLinha(titulares);

  return `
    <div style="margin-bottom:18px;">
      <div class="pitch-formation-label">${t?.nome || ''} · ${formacaoLabel(linhas)}</div>
      <div class="pitch">
        <div class="pitch-goal-box top"></div>
        ${[4, 3, 2, 1, 0].filter(n => linhas[n].length).map(n => `
          <div class="pitch-line">${linhas[n].map(e => renderPitchPlayer(e, icones)).join('')}</div>
        `).join('')}
        <div class="pitch-goal-box bottom"></div>
      </div>
      ${reservas.length ? `
        <div class="pitch-reserves">
          <div class="pitch-reserves-label">Reservas</div>
          ${reservas.map(e => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-top:1px solid var(--border-soft); font-size:0.82rem;">
              <span>${e.jogadores?.numero ? '#' + e.jogadores.numero + ' ' : ''}${e.jogadores?.nome || ''} <span style="color:var(--text-muted); font-size:0.72rem;">${e.jogadores?.posicao || ''}</span> ${icones(e.jogador_id)}</span>
              ${e.nota !== null ? `<b style="color:var(--gold-bright);">${Number(e.nota).toFixed(1)}</b>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
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
    const [escalacao, eventos, subs] = await Promise.all([
      fetchEscalacao(matchId),
      fetchEventos({ partidaId: matchId }),
      fetchSubstituicoes(matchId),
    ]);

    const icones = (jogadorId) => {
      const cartoes = eventos.filter(e => e.jogador_id === jogadorId);
      const saiu = subs.find(s => s.jogador_sai_id === jogadorId);
      const entrou = subs.find(s => s.jogador_entra_id === jogadorId);
      let out = '';
      cartoes.forEach(c => { if (TIPO_EVENTO_LABEL_PUBLICO[c.tipo]) out += `<span>${TIPO_EVENTO_LABEL_PUBLICO[c.tipo]}</span>`; });
      if (saiu) out += '<span>🔻</span>';
      if (entrou) out += '<span>🔺</span>';
      return out;
    };

    const escalacaoA = escalacao.filter(e => e.equipe_id === tA?.id);
    const escalacaoB = escalacao.filter(e => e.equipe_id === tB?.id);

    document.getElementById('modal-body').innerHTML =
      renderPitchTeam(tA, escalacaoA, icones) + renderPitchTeam(tB, escalacaoB, icones);
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<p style="color:var(--danger-strong);">Erro ao carregar: ${e.message}</p>`;
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
  renderCategoriaToggles();

  try {
    await loadData();
  } catch (e) {
    console.error('Erro ao carregar dados públicos:', e);
  }

  renderAll();
  renderSponsors();
  initLiveWidget();

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocalDev) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
