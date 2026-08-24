// =====================================================================
// admin.js — Painel Administrativo SUMED 2026
// Requer: supabaseClient.js, data.js carregados antes deste arquivo.
// =====================================================================

let currentUser = null;
let adminCategoria = 'masculino';
let adminRound = 1;
let teams = [];
let matches = [];
let jogadoresPendentes = []; // linhas do formulário "Nova Equipe" ainda não salvas

const ROLE_LABELS = {
  admin_master: 'AdminMaster',
  presidente: 'Presidente',
  diretor: 'Diretor',
};

// ---------------------------------------------------------------------
// NAVEGAÇÃO (mesmo padrão de telas + bottom nav do app público)
// ---------------------------------------------------------------------
const ADMIN_NAV_MAP = {
  sorteio: 'sorteio', placar: 'placar', equipes: 'equipes', disciplina: 'disciplina',
  mais: 'mais', patrocinadores: 'mais', usuarios: 'mais',
};

function switchAdminScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-' + screenId).classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.bottom-nav-item[data-screen="${ADMIN_NAV_MAP[screenId]}"]`)?.classList.add('active');

  if (screenId === 'placar') loadAdminRound();
  if (screenId === 'equipes') renderAdminTeamsList();
  if (screenId === 'patrocinadores') renderAdminSponsorsList();
  if (screenId === 'usuarios') renderAdminUsersList();
  if (screenId === 'disciplina') initDisciplinaTab();

  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// TOGGLE MASCULINO / FEMININO (global do painel)
// ---------------------------------------------------------------------
function renderAdminCategoriaToggle() {
  document.getElementById('admin-categoria-toggle').innerHTML = `
    <button class="pill-btn ${adminCategoria === 'masculino' ? 'active' : ''}" onclick="setAdminCategoria('masculino')">Masculino</button>
    <button class="pill-btn ${adminCategoria === 'feminino' ? 'active' : ''}" onclick="setAdminCategoria('feminino')">Feminino</button>
  `;
  const label = document.getElementById('nova-equipe-categoria-label');
  if (label) label.innerText = `— categoria ${adminCategoria === 'masculino' ? 'Masculino' : 'Feminino'}`;
}

async function setAdminCategoria(categoria) {
  if (adminCategoria === categoria) return;
  adminCategoria = categoria;
  adminRound = 1;
  renderAdminCategoriaToggle();
  teams = await fetchTeams(adminCategoria);
  renderAdminTeamsSummary();
  renderAdminTeamsList();

  const activeScreen = document.querySelector('.screen.active')?.id?.replace('screen-', '');
  if (activeScreen === 'placar') loadAdminRound();
  if (activeScreen === 'disciplina') initDisciplinaTab();
}

// ---------------------------------------------------------------------
// GUARD DE SESSÃO
// ---------------------------------------------------------------------
async function initAdmin() {
  currentUser = await requireRole([ROLES.ADMIN_MASTER, ROLES.PRESIDENTE, ROLES.DIRETOR]);
  if (!currentUser) return; // requireRole já redirecionou

  document.getElementById('user-badge').innerText =
    `${currentUser.profile.nome} · ${ROLE_LABELS[currentUser.profile.role]}`;

  // Gerar Sorteio: só AdminMaster/Presidente
  const podeGerarSorteio = [ROLES.ADMIN_MASTER, ROLES.PRESIDENTE].includes(currentUser.profile.role);
  document.getElementById('btn-gerar-sorteio').style.display = podeGerarSorteio ? 'block' : 'none';
  document.getElementById('sorteio-restrito-msg').style.display = podeGerarSorteio ? 'none' : 'block';

  // Criar/excluir equipes: só AdminMaster/Presidente (Diretor edita, não cria)
  const podeCriarEquipe = [ROLES.ADMIN_MASTER, ROLES.PRESIDENTE].includes(currentUser.profile.role);
  document.getElementById('card-nova-equipe').style.display = podeCriarEquipe ? 'block' : 'none';

  // Menu "Usuários": só AdminMaster
  if (currentUser.profile.role === ROLES.ADMIN_MASTER) {
    document.getElementById('menu-usuarios').style.display = 'flex';
  }

  renderAdminCategoriaToggle();

  try {
    teams = await fetchTeams(adminCategoria);
  } catch (e) {
    console.error(e);
  }

  renderAdminTeamsSummary();
  addJogadorRow(); // primeira linha do formulário já vem pronta
  renderAdminTeamsList();
}

function previewImage(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const file = input.files[0];
  if (!file) { preview.style.display = 'none'; return; }
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
}

// ---------------------------------------------------------------------
// SORTEIO
// ---------------------------------------------------------------------
function renderAdminTeamsSummary() {
  const el = document.getElementById('admin-teams-summary');
  if (!el) return;
  el.innerHTML = teams.length
    ? `<p style="color:var(--text-muted); font-size:0.85rem;">${teams.length} equipe(s) cadastrada(s) nesta categoria.</p>`
    : `<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma equipe cadastrada ainda. Vá em "Equipes" para cadastrar.</p>`;
}

async function generateDraw() {
  const podeGerarSorteio = [ROLES.ADMIN_MASTER, ROLES.PRESIDENTE].includes(currentUser.profile.role);
  if (!podeGerarSorteio) {
    alert('Apenas AdminMaster ou Presidente podem gerar um novo sorteio.');
    return;
  }
  if (!confirm(`Isso redefinirá todas as partidas e placares existentes da categoria ${adminCategoria === 'masculino' ? 'Masculino' : 'Feminino'}. Deseja continuar?`)) return;
  if (teams.length < 2) {
    alert('Cadastre ao menos 2 equipes antes de gerar o sorteio.');
    return;
  }

  try {
    await gerarSorteio(teams.map(t => t.id), adminCategoria);
    alert(`Sorteio oficial gerado para a categoria ${adminCategoria === 'masculino' ? 'Masculino' : 'Feminino'}!`);
  } catch (e) {
    alert('Erro ao gerar sorteio: ' + e.message);
  }
}

// ---------------------------------------------------------------------
// PLACAR (resultado + data/hora/local unificados por partida)
// ---------------------------------------------------------------------
function changeAdminRound(dir) {
  adminRound = Math.min(13, Math.max(1, adminRound + dir));
  renderAdminRound();
}

async function loadAdminRound() {
  try {
    matches = await fetchMatches(adminCategoria);
  } catch (e) {
    console.error(e);
    matches = [];
  }
  renderAdminRound();
}

function renderAdminRound() {
  document.getElementById('admin-round-title').innerText = `Rodada ${adminRound}`;
  const container = document.getElementById('admin-matches-list');
  const roundMatches = matches.filter(m => m.rodada === adminRound);

  if (!roundMatches.length) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px 0;">Nenhuma partida nesta rodada. Gere o sorteio primeiro.</p>';
    return;
  }

  container.innerHTML = roundMatches.map(m => {
    if (m.is_bye) {
      const t = teams.find(x => x.id === m.equipe_a)?.nome || 'Equipe';
      return `<div class="bye-card">⏸️ <b>Folga:</b> ${t}</div>`;
    }
    const tA = teams.find(x => x.id === m.equipe_a)?.nome || '?';
    const tB = teams.find(x => x.id === m.equipe_b)?.nome || '?';

    return `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px;">
          <span style="font-weight:700; font-size:0.9rem;">${tA}</span>
          <input type="number" id="scA_${m.id}" value="${m.placar_a ?? ''}" class="form-control" style="width:54px; text-align:center; flex-shrink:0;">
          <span style="color:var(--text-muted);">×</span>
          <input type="number" id="scB_${m.id}" value="${m.placar_b ?? ''}" class="form-control" style="width:54px; text-align:center; flex-shrink:0;">
          <span style="font-weight:700; font-size:0.9rem; text-align:right;">${tB}</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <input type="date" id="date_${m.id}" value="${m.data || ''}" class="form-control">
          <input type="time" id="time_${m.id}" value="${m.hora || ''}" class="form-control">
        </div>
        <input type="text" id="local_${m.id}" value="${m.local || ''}" placeholder="Local" class="form-control" style="margin-top:8px;">
        <button class="btn-action" style="width:100%; margin-top:10px;" onclick="saveMatchUI('${m.id}')">Salvar</button>
      </div>
    `;
  }).join('');
}

async function saveMatchUI(matchId) {
  const valA = document.getElementById(`scA_${matchId}`).value;
  const valB = document.getElementById(`scB_${matchId}`).value;
  const data = document.getElementById(`date_${matchId}`).value;
  const hora = document.getElementById(`time_${matchId}`).value;
  const local = document.getElementById(`local_${matchId}`).value;

  try {
    await Promise.all([
      saveMatchScore(matchId, valA, valB),
      saveMatchMeta(matchId, { data, hora, local }),
    ]);
    alert('Partida atualizada!');
    await loadAdminRound();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ---------------------------------------------------------------------
// EQUIPES + JOGADORES (formulário dinâmico)
// ---------------------------------------------------------------------
function addJogadorRow() {
  const id = 'jr_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  jogadoresPendentes.push({ rowId: id, nome: '', numero: '', posicao: '', fotoFile: null });

  const list = document.getElementById('jogadores-list');
  const row = document.createElement('div');
  row.className = 'jogador-row';
  row.id = id;
  row.innerHTML = `
    <img class="upload-preview" id="prev_${id}" style="display:none; width:40px; height:40px;">
    <input type="text" class="form-control" placeholder="Nome do jogador" oninput="updateJogadorField('${id}','nome',this.value)">
    <input type="number" class="form-control" style="max-width:60px;" placeholder="Nº" oninput="updateJogadorField('${id}','numero',this.value)">
    <select class="form-control" style="max-width:80px;" onchange="updateJogadorField('${id}','posicao',this.value)">
      <option value="">Posição</option>
      <option value="GOL">GOL</option>
      <option value="ZAG">ZAG</option>
      <option value="LD">LD</option>
      <option value="LE">LE</option>
      <option value="MC">MC</option>
      <option value="MD">MD</option>
      <option value="ME">ME</option>
      <option value="PE">PE</option>
      <option value="PD">PD</option>
      <option value="CA">CA</option>
    </select>
    <input type="file" accept="image/*" style="max-width:120px; font-size:0.7rem;" onchange="handleJogadorFoto('${id}', this)">
    <button type="button" class="btn-remove" onclick="removeJogadorRow('${id}')">✕</button>
  `;
  list.appendChild(row);
}

function updateJogadorField(rowId, field, value) {
  const row = jogadoresPendentes.find(j => j.rowId === rowId);
  if (row) row[field] = value;
}

function handleJogadorFoto(rowId, input) {
  const row = jogadoresPendentes.find(j => j.rowId === rowId);
  if (row) row.fotoFile = input.files[0] || null;
  const preview = document.getElementById(`prev_${rowId}`);
  if (row.fotoFile) {
    preview.src = URL.createObjectURL(row.fotoFile);
    preview.style.display = 'block';
  }
}

function removeJogadorRow(rowId) {
  jogadoresPendentes = jogadoresPendentes.filter(j => j.rowId !== rowId);
  document.getElementById(rowId)?.remove();
}

async function saveTeam(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-salvar-equipe');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const nome = document.getElementById('team-name').value;
    const presidente = document.getElementById('team-president').value;
    const capitao = document.getElementById('team-captain').value;
    const comissao_tecnica = document.getElementById('team-staff').value;
    const diretor_marketing = document.getElementById('team-marketing').value;
    const escudoFile = document.getElementById('team-escudo').files[0] || null;

    const jogadoresValidos = jogadoresPendentes.filter(j => j.nome && j.nome.trim());

    await createTeam({ nome, presidente, capitao, comissao_tecnica, diretor_marketing, categoria: adminCategoria, escudoFile, jogadores: jogadoresValidos });

    alert('Equipe cadastrada!');
    document.getElementById('form-team').reset();
    document.getElementById('escudo-preview').style.display = 'none';
    document.getElementById('jogadores-list').innerHTML = '';
    jogadoresPendentes = [];
    addJogadorRow();

    teams = await fetchTeams(adminCategoria);
    renderAdminTeamsSummary();
    renderAdminTeamsList();
  } catch (err) {
    alert('Erro ao salvar equipe: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Equipe';
  }
}

function renderAdminTeamsList() {
  const container = document.getElementById('admin-teams-list');
  if (!container) return;

  container.innerHTML = teams.map(t => `
    <div class="card" style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
      ${t.escudo_url ? `<img src="${t.escudo_url}" class="upload-preview">` : '<div style="font-size:1.8rem;">🛡️</div>'}
      <div style="flex:1;">
        <b>${t.nome}</b>
        <p style="font-size:0.8rem; color:var(--text-muted);">${(t.jogadores || []).length} jogador(es) cadastrado(s)</p>
      </div>
    </div>
  `).join('') || '<p style="color:var(--text-muted); text-align:center; padding:16px 0;">Nenhuma equipe cadastrada nesta categoria ainda.</p>';
}

// ---------------------------------------------------------------------
// PATROCINADORES
// ---------------------------------------------------------------------
async function saveSponsor(e) {
  e.preventDefault();
  const nome = document.getElementById('sponsor-name').value;
  const link = document.getElementById('sponsor-link').value;
  const ordem = parseInt(document.getElementById('sponsor-order').value) || 0;
  const logoFile = document.getElementById('sponsor-logo').files[0];

  if (!logoFile) { alert('Selecione a logo do patrocinador.'); return; }

  try {
    await createSponsor({ nome, link, ordem, logoFile });
    alert('Patrocinador salvo!');
    document.getElementById('form-sponsor').reset();
    document.getElementById('sponsor-preview').style.display = 'none';
    renderAdminSponsorsList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function renderAdminSponsorsList() {
  const container = document.getElementById('admin-sponsors-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);">Carregando...</p>';

  try {
    const sponsors = await fetchAllSponsors();
    container.innerHTML = sponsors.map(s => `
      <div class="card" style="display:flex; align-items:center; gap:12px; margin-bottom:8px; ${s.ativo ? '' : 'opacity:0.5;'}">
        <img src="${s.logo_url}" class="upload-preview" style="border-radius:6px;">
        <div style="flex:1;">
          <b>${s.nome}</b>
          <p style="font-size:0.8rem; color:var(--text-muted);">${s.link || 'sem link'}</p>
        </div>
        <button class="btn-secondary" onclick="toggleSponsorUI('${s.id}', ${!s.ativo})">${s.ativo ? 'Desativar' : 'Ativar'}</button>
        <button class="btn-remove" onclick="deleteSponsorUI('${s.id}')">✕</button>
      </div>
    `).join('') || '<p style="color:var(--text-muted);">Nenhum patrocinador cadastrado.</p>';
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger-strong);">Erro ao carregar: ${e.message}</p>`;
  }
}

async function toggleSponsorUI(id, ativo) {
  try {
    await toggleSponsor(id, ativo);
    renderAdminSponsorsList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function deleteSponsorUI(id) {
  if (!confirm('Excluir este patrocinador?')) return;
  try {
    await deleteSponsor(id);
    renderAdminSponsorsList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ---------------------------------------------------------------------
// USUÁRIOS (AdminMaster) — via Edge Function manage-users
// ---------------------------------------------------------------------
async function saveUser(e) {
  e.preventDefault();
  const nome = document.getElementById('user-name').value;
  const email = document.getElementById('user-email').value;
  const senha = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;

  try {
    const { data, error } = await sb.functions.invoke('manage-users', {
      body: { action: 'create', nome, email, senha, role },
    });
    if (error || data?.error) throw new Error(data?.error || error.message);

    alert('Usuário criado!');
    document.getElementById('form-user').reset();
    renderAdminUsersList();
  } catch (e) {
    alert('Erro ao criar usuário: ' + e.message);
  }
}

async function renderAdminUsersList() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);">Carregando...</p>';

  try {
    const { data, error } = await sb.functions.invoke('manage-users', { body: { action: 'list' } });
    if (error || data?.error) throw new Error(data?.error || error.message);

    container.innerHTML = data.usuarios.map(u => `
      <div class="card" style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
        <div style="flex:1;">
          <b>${u.nome}</b> <span class="badge-role">${ROLE_LABELS[u.role] || u.role}</span>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${u.email}</p>
        </div>
        ${u.id !== currentUser.session.user.id ? `<button class="btn-remove" onclick="deleteUserUI('${u.id}')">✕</button>` : ''}
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger-strong);">Erro ao carregar: ${e.message}</p>`;
  }
}

async function deleteUserUI(userId) {
  if (!confirm('Excluir este usuário? Ele perderá o acesso imediatamente.')) return;
  try {
    const { data, error } = await sb.functions.invoke('manage-users', {
      body: { action: 'delete', userId },
    });
    if (error || data?.error) throw new Error(data?.error || error.message);
    renderAdminUsersList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ---------------------------------------------------------------------
// DISCIPLINA (cartões, contusões, punições, suspensões)
// ---------------------------------------------------------------------
const TIPO_EVENTO_LABEL = {
  cartao_amarelo: '🟨 Amarelo',
  cartao_vermelho: '🟥 Vermelho',
  contusao: '🩹 Contusão',
  punicao: '⚠️ Punição',
  suspensao: '⛔ Suspensão',
  outro: '📌 Outro',
};

async function initDisciplinaTab() {
  teams = await fetchTeams(adminCategoria);
  matches = await fetchMatches(adminCategoria);

  const equipeSelect = document.getElementById('evento-equipe');
  equipeSelect.innerHTML = teams.map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
  populateJogadoresDoEvento();

  const partidaSelect = document.getElementById('evento-partida');
  const opcoesPartidas = matches.filter(m => !m.is_bye).map(m => {
    const tA = teams.find(t => t.id === m.equipe_a)?.nome || '?';
    const tB = teams.find(t => t.id === m.equipe_b)?.nome || '?';
    return `<option value="${m.id}">Rodada ${m.rodada} — ${tA} × ${tB}</option>`;
  }).join('');
  partidaSelect.innerHTML = '<option value="">— Não vinculada a uma partida —</option>' + opcoesPartidas;

  renderAdminEventosList();
}

function populateJogadoresDoEvento() {
  const equipeId = document.getElementById('evento-equipe').value;
  const equipe = teams.find(t => t.id === equipeId);
  const jogadorSelect = document.getElementById('evento-jogador');
  jogadorSelect.innerHTML = (equipe?.jogadores || [])
    .map(j => `<option value="${j.id}">${j.numero ? '#' + j.numero + ' ' : ''}${j.nome}</option>`)
    .join('') || '<option value="">Nenhum jogador cadastrado nesta equipe</option>';
}

function toggleSuspensaoField() {
  const tipo = document.getElementById('evento-tipo').value;
  document.getElementById('grupo-rodada-suspensao').style.display = tipo === 'suspensao' ? 'block' : 'none';
}

async function saveEvento(e) {
  e.preventDefault();
  const equipe_id = document.getElementById('evento-equipe').value;
  const jogador_id = document.getElementById('evento-jogador').value;
  const tipo = document.getElementById('evento-tipo').value;
  const partida_id = document.getElementById('evento-partida').value;
  const minuto = document.getElementById('evento-minuto').value;
  const rodada_suspensao = document.getElementById('evento-rodada-suspensao').value;
  const descricao = document.getElementById('evento-descricao').value;

  if (!jogador_id) { alert('Selecione um jogador válido.'); return; }

  try {
    await createEvento({ jogador_id, equipe_id, partida_id, tipo, minuto, descricao, rodada_suspensao });
    alert('Ocorrência registrada!');
    document.getElementById('form-evento').reset();
    toggleSuspensaoField();
    renderAdminEventosList();
  } catch (err) {
    alert('Erro ao registrar: ' + err.message);
  }
}

async function renderAdminEventosList() {
  const container = document.getElementById('admin-eventos-list');
  container.innerHTML = '<p style="color:var(--text-muted);">Carregando...</p>';

  try {
    const eventos = await fetchEventos();
    container.innerHTML = eventos.map(ev => `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div>
            <b>${TIPO_EVENTO_LABEL[ev.tipo] || ev.tipo}</b> — ${ev.jogadores?.nome || 'Jogador removido'} <span style="color:var(--text-muted);">(${ev.equipes?.nome || ''})</span>
            ${ev.minuto ? `<span style="color:var(--text-muted);"> · ${ev.minuto}'</span>` : ''}
            ${ev.tipo === 'suspensao' && ev.rodada_suspensao ? `<div style="font-size:0.8rem; color:var(--text-muted);">Cumpre na Rodada ${ev.rodada_suspensao} ${ev.cumprida ? '✅ Cumprida' : ''}</div>` : ''}
            ${ev.descricao ? `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">${ev.descricao}</p>` : ''}
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">
            ${ev.tipo === 'suspensao' ? `<button class="btn-secondary" onclick="toggleEventoCumpridaUI('${ev.id}', ${!ev.cumprida})">${ev.cumprida ? 'Reabrir' : 'Cumprida'}</button>` : ''}
            <button class="btn-remove" onclick="deleteEventoUI('${ev.id}')">✕</button>
          </div>
        </div>
      </div>
    `).join('') || '<p style="color:var(--text-muted);">Nenhuma ocorrência registrada.</p>';
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger-strong);">Erro ao carregar: ${e.message}</p>`;
  }
}

async function toggleEventoCumpridaUI(id, cumprida) {
  try {
    await toggleEventoCumprida(id, cumprida);
    renderAdminEventosList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function deleteEventoUI(id) {
  if (!confirm('Excluir esta ocorrência?')) return;
  try {
    await deleteEvento(id);
    renderAdminEventosList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', initAdmin);
