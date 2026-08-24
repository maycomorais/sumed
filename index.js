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
  renderCategoriaToggles();
  await loadData();
  renderAll();
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
// HOME — Próxima Rodada
// ---------------------------------------------------------------------
function renderHero() {
  const el = document.getElementById('hero-next-match');
  if (!el) return;

  const proxima = state.matches
    .filter(m => !m.is_bye && m.status === 'SCHEDULED')
    .sort((a, b) => a.rodada - b.rodada)[0];

  if (!proxima) {
    el.innerHTML = `<p style="color:var(--text-muted); padding:20px 0;">Nenhum jogo agendado. Gere o sorteio no painel admin.</p>`;
    return;
  }

  const teamA = state.teams.find(t => t.id === proxima.equipe_a);
  const teamB = state.teams.find(t => t.id === proxima.equipe_b);

  el.innerHTML = `
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
    <div class="hero-meta">${proxima.data ? formatDate(proxima.data) : 'Data a definir'}${proxima.hora ? ', ' + proxima.hora : ''}</div>
    <span class="hero-tag">Rodada ${proxima.rodada}</span>
    <div class="hero-location">📍 ${proxima.local || 'Campo Principal'}</div>
    <button class="btn-action" style="width:100%;" onclick="openSumula('${proxima.id}')">Ver Detalhes →</button>
  `;
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

    html += `
      <div class="match-card">
        <div class="match-meta">
          <span>📅 ${m.data ? formatDate(m.data) : 'A definir'} • ${m.hora || '--:--'}</span>
          <span>📍 ${m.local || 'Campo Principal'}</span>
        </div>
        <div class="match-teams">
          <div class="team-box">${teamA}</div>
          <div class="score">${scoreA} × ${scoreB}</div>
          <div class="team-box away">${teamB}</div>
        </div>
        <div style="text-align:right; margin-top:8px;">
          <button onclick="openSumula('${m.id}')" style="background:none; border:none; color:var(--gold-bright); font-size:0.78rem; cursor:pointer;">📄 Ver Súmula</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  byeContainer.innerHTML = byeTeam ? `<div class="bye-card">⏸️ <b>Folga na rodada:</b> ${byeTeam}</div>` : '';
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
// SÚMULA / REGULAMENTO (modal)
// ---------------------------------------------------------------------
async function openSumula(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;

  const teamA = state.teams.find(t => t.id === m.equipe_a)?.nome;
  const teamB = state.teams.find(t => t.id === m.equipe_b)?.nome;

  document.getElementById('modal-title').innerText = 'Súmula de Jogo';
  document.getElementById('modal-body').innerHTML = `
    <div style="text-align:center; margin-bottom:15px;">
      <h3>${teamA} ${m.placar_a ?? '-'} × ${m.placar_b ?? '-'} ${teamB}</h3>
      <small style="color:var(--text-muted);">${m.data ? formatDate(m.data) : ''} • ${m.local || ''}</small>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:8px;">Ocorrências</div>
      <div id="sumula-eventos"><p style="font-size:0.85rem; color:var(--text-muted);">Carregando...</p></div>
    </div>
  `;
  document.getElementById('app-modal').classList.add('active');

  try {
    const eventos = await fetchEventos({ partidaId: matchId });
    document.getElementById('sumula-eventos').innerHTML = eventos.length
      ? eventos.map(ev => `
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">
            ${TIPO_EVENTO_LABEL_PUBLICO[ev.tipo] || '📌'} <b style="color:var(--text);">${ev.jogadores?.nome || ''}</b>
            (${ev.equipes?.nome || ''})${ev.minuto ? ` — ${ev.minuto}'` : ''}${ev.descricao ? ` · ${ev.descricao}` : ''}
          </p>
        `).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">Nenhuma ocorrência gravada em súmula.</p>';
  } catch (e) { console.error(e); }
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

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocalDev) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
