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
let minJogadoresExigidos = 11; // atualizado a partir do "Formato do Campeonato" da categoria
const MAX_JOGADORES_POR_EQUIPE = 10; // limite fixo de elenco, independente do "Formato do Campeonato"

// Retorna o número de camisa duplicado (como string) se houver colisão
// entre os jogadores informados, ignorando linhas sem número preenchido e,
// opcionalmente, uma linha/jogador específico (útil ao editar um já
// existente, pra não comparar ele com ele mesmo).
function numeroDuplicadoEntre(jogadores, { excetoRowId, excetoJogadorId } = {}) {
  const contagem = {};
  for (const j of jogadores) {
    if (excetoRowId && j.rowId === excetoRowId) continue;
    if (excetoJogadorId && j.id === excetoJogadorId) continue;
    const num = (j.numero ?? '').toString().trim();
    if (num === '') continue;
    contagem[num] = (contagem[num] || 0) + 1;
    if (contagem[num] > 1) return num;
  }
  return null;
}

function refreshCapitaoOptions() {
  const select = document.getElementById('team-captain');
  if (!select || editingTeamId) return; // no modo edição quem popula é atualizarSelectCapitao(t)
  const atual = select.value;
  const nomesValidos = jogadoresPendentes.map(j => j.nome).filter(n => n && n.trim());

  select.innerHTML = '<option value="">— Nenhum —</option>' + nomesValidos.map(n => `<option value="${n}">${n}</option>`).join('');
  if (nomesValidos.includes(atual)) select.value = atual;
}

function atualizarSelectCapitao(t) {
  const select = document.getElementById('team-captain');
  if (!select) return;
  const jogadores = t.jogadores || [];
  const atual = t.capitao && t.capitao !== 'A definir' ? t.capitao : '';

  select.innerHTML = '<option value="">— Nenhum —</option>' + jogadores.map(j => `<option value="${j.nome}">${j.nome}</option>`).join('');
  select.value = jogadores.some(j => j.nome === atual) ? atual : '';
}

function updateMinJogadoresNote() {
  const el = document.getElementById('min-jogadores-note');
  if (!el) return;
  const validos = jogadoresPendentes.filter(j => j.nome && j.nome.trim()).length;
  el.textContent = `${validos} de ${minJogadoresExigidos} jogadores mínimos preenchidos.`;
  el.classList.toggle('atendido', validos >= minJogadoresExigidos);
}

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
  mais: 'mais', patrocinadores: 'mais', usuarios: 'mais', formato: 'mais', identidade: 'mais',
  'sumula-admin': 'placar',
};

let sumulaMatchId = null;
let editingTeamId = null;

function switchAdminScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-' + screenId).classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.bottom-nav-item[data-screen="${ADMIN_NAV_MAP[screenId]}"]`)?.classList.add('active');

  if (screenId === 'placar') loadAdminRound();
  if (screenId === 'sorteio') loadCalendarioCompleto();
  if (screenId === 'equipes') renderAdminTeamsList();
  if (screenId === 'patrocinadores') renderAdminSponsorsList();
  if (screenId === 'usuarios') renderAdminUsersList();
  if (screenId === 'disciplina') initDisciplinaTab();
  if (screenId === 'formato') initFormatoTab();
  if (screenId === 'identidade') initIdentidadeTab();

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
  await loadMinJogadoresExigidos();

  const activeScreen = document.querySelector('.screen.active')?.id?.replace('screen-', '');
  if (activeScreen === 'placar') loadAdminRound();
  if (activeScreen === 'sorteio') loadCalendarioCompleto();
  if (activeScreen === 'disciplina') initDisciplinaTab();
}

const POSICOES_POR_MODALIDADE = {
  campo: ['GOL', 'ZAG', 'LD', 'LE', 'MC', 'MD', 'ME', 'PE', 'PD', 'CA'],
  quadra: ['GOL', 'FIXO', 'ALA', 'PIVO'],
  society: ['GOL', 'FIXO', 'ALA', 'PIVO'],
};
let posicoesAtuais = POSICOES_POR_MODALIDADE.campo;

async function loadMinJogadoresExigidos() {
  try {
    const cfg = await fetchModalidade(adminCategoria);
    minJogadoresExigidos = cfg.titulares || 11;
    posicoesAtuais = POSICOES_POR_MODALIDADE[cfg.modalidade] || POSICOES_POR_MODALIDADE.campo;
  } catch (e) {
    minJogadoresExigidos = 11;
    posicoesAtuais = POSICOES_POR_MODALIDADE.campo;
  }
  updateMinJogadoresNote();
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
  await loadMinJogadoresExigidos();
  addJogadorRow(); // primeira linha do formulário já vem pronta, com as posições certas
  renderAdminTeamsList();
  await loadAdminRound(); // tela inicial agora é "Placar"
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

async function loadCalendarioCompleto() {
  const container = document.getElementById('admin-calendario-completo');
  container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Carregando...</p>';
  try {
    const todasPartidas = await fetchMatches(adminCategoria);
    if (!todasPartidas.length) {
      container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum sorteio gerado ainda nesta categoria.</p>';
      return;
    }
    const porRodada = {};
    todasPartidas.forEach(m => { (porRodada[m.rodada] = porRodada[m.rodada] || []).push(m); });

    container.innerHTML = Object.keys(porRodada).sort((a, b) => a - b).map(r => `
      <div class="card" style="margin-bottom:8px;">
        <p style="font-weight:700; margin-bottom:8px; font-size:0.88rem;">Rodada ${r}</p>
        ${porRodada[r].map(m => {
          if (m.is_bye) {
            const t = teams.find(x => x.id === m.equipe_a)?.nome || '?';
            return `<p style="color:var(--text-muted); font-size:0.8rem; padding:3px 0;">⏸️ Folga: ${t}</p>`;
          }
          const tA = teams.find(x => x.id === m.equipe_a)?.nome || '?';
          const tB = teams.find(x => x.id === m.equipe_b)?.nome || '?';
          const placar = m.status === 'FINISHED' ? `${m.placar_a} × ${m.placar_b}` : 'vs';
          return `<p style="font-size:0.82rem; padding:3px 0; border-top:1px solid var(--border-soft);">${tA} <span style="color:var(--gold-bright); font-weight:700;">${placar}</span> ${tB}</p>`;
        }).join('')}
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger-strong); font-size:0.85rem;">Erro ao carregar: ${e.message}</p>`;
  }
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
    loadCalendarioCompleto();
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

// ---------------------------------------------------------------------
// W.O. (Art. 29º) — placar administrativo 3×0, sem coluna dedicada no
// banco. Guardamos um marcador reconhecível dentro de sumula_nota (ver
// registrarWO em data.js) pra dar pra contar ocorrências por equipe.
const WO_MARK_REGEX = /\[WO\|responsavel=([a-f0-9-]+)\]/;

function parseWOResponsavel(m) {
  const match = (m.sumula_nota || '').match(WO_MARK_REGEX);
  return match ? match[1] : null;
}

// Conta em quantas partidas da categoria essa equipe já foi responsável
// por um W.O. (considerando todas as rodadas já carregadas em `matches`).
function contarOcorrenciasWO(equipeId) {
  return matches.filter(m => parseWOResponsavel(m) === equipeId).length;
}

async function registrarWOUI(matchId, equipeResponsavelId) {
  const m = matches.find(x => x.id === matchId);
  if (!m) return;
  const nomeEquipe = teams.find(t => t.id === equipeResponsavelId)?.nome || 'Equipe';
  const seraOcorrenciaNumero = contarOcorrenciasWO(equipeResponsavelId) + 1;

  const avisoOcorrencia = seraOcorrenciaNumero >= 2
    ? `\n\n🚨 Esta será a ${seraOcorrenciaNumero}ª ocorrência de W.O. desta equipe na competição. Conforme Art. 29º, duas ocorrências podem resultar na exclusão da equipe da competição.`
    : `\n\nEsta é a 1ª ocorrência de W.O. desta equipe na competição.`;

  const confirmMsg = `Registrar W.O. da equipe ${nomeEquipe} nesta partida?\n\n`
    + `Isso grava o placar administrativo 3×0 a favor do adversário, encerra e trava a partida (Art. 29º). A multa de 100.000 Gs deve ser controlada manualmente no financeiro.`
    + avisoOcorrencia;

  if (!confirm(confirmMsg)) return;

  try {
    await registrarWO(matchId, equipeResponsavelId, m.equipe_a, m.equipe_b);
    if (seraOcorrenciaNumero >= 2) {
      alert(`🚨 Atenção: esta é a ${seraOcorrenciaNumero}ª ocorrência de W.O. da equipe ${nomeEquipe}. Avalie a exclusão da equipe da competição conforme Art. 29º.`);
    } else {
      alert('W.O. registrado! Placar administrativo 3×0 aplicado e partida travada.');
    }
    await loadAdminRound();
  } catch (e) {
    alert('Erro ao registrar W.O.: ' + e.message);
  }
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
    const travado = !!m.placar_travado;
    const woResponsavel = parseWOResponsavel(m);

    return `
      <div class="card" style="${travado ? 'border-color: var(--gold);' : ''}">
        ${travado ? `<p style="color:var(--gold); font-size:0.72rem; font-weight:700; margin-bottom:8px;">🔒 PARTIDA ENCERRADA — placar travado</p>` : ''}
        ${woResponsavel ? `<p style="color:var(--danger-strong); font-size:0.72rem; font-weight:700; margin-bottom:8px;">⚠️ Encerrada por W.O. — responsável: ${teams.find(t => t.id === woResponsavel)?.nome || 'equipe removida'}</p>` : ''}
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px;">
          <span style="font-weight:700; font-size:0.9rem;">${tA}</span>
          <input type="number" id="scA_${m.id}" value="${m.placar_a ?? ''}" class="form-control" style="width:54px; text-align:center; flex-shrink:0;" ${travado ? 'disabled' : ''}>
          <span style="color:var(--text-muted);">×</span>
          <input type="number" id="scB_${m.id}" value="${m.placar_b ?? ''}" class="form-control" style="width:54px; text-align:center; flex-shrink:0;" ${travado ? 'disabled' : ''}>
          <span style="font-weight:700; font-size:0.9rem; text-align:right;">${tB}</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <input type="date" id="date_${m.id}" value="${m.data || ''}" class="form-control">
          <input type="time" id="time_${m.id}" value="${m.hora || ''}" class="form-control">
        </div>
        <input type="text" id="local_${m.id}" value="${m.local || ''}" placeholder="Local" class="form-control" style="margin-top:8px;">
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-action" style="flex:1;" onclick="saveMatchUI('${m.id}')">Salvar</button>
          <button class="btn-secondary" onclick="openSumulaAdmin('${m.id}')">📋 Súmula</button>
        </div>
        ${!travado ? `<button class="btn-secondary" style="width:100%; margin-top:8px; border-color:var(--danger-strong); color:var(--danger-strong);" onclick="encerrarPartidaUI('${m.id}')">🔒 Encerrar Partida (trava o placar)</button>` : ''}
        ${!travado ? `
          <details style="margin-top:8px;">
            <summary style="color:var(--danger-strong); font-size:0.78rem; cursor:pointer;">⚠️ Registrar W.O. (Art. 29º)</summary>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="btn-secondary" style="flex:1; font-size:0.75rem;" onclick="registrarWOUI('${m.id}','${m.equipe_a}')">${tA} não compareceu</button>
              <button class="btn-secondary" style="flex:1; font-size:0.75rem;" onclick="registrarWOUI('${m.id}','${m.equipe_b}')">${tB} não compareceu</button>
            </div>
          </details>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function encerrarPartidaUI(matchId) {
  if (!confirm('Encerrar esta partida? O placar não poderá mais ser alterado depois disso. Cartões, gols e assistências continuam editáveis.')) return;
  try {
    await encerrarPartida(matchId);
    await loadAdminRound();
  } catch (e) {
    alert('Erro ao encerrar: ' + e.message);
  }
}

async function aplicarDataRodadaUI() {
  const data = document.getElementById('bulk-round-date').value;
  if (!data) { alert('Escolha uma data.'); return; }
  try {
    await bulkSetRoundDate(adminCategoria, adminRound, data);
    alert(`Data aplicada a todos os jogos da Rodada ${adminRound}!`);
    await loadAdminRound();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
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
// FORMATO DO CAMPEONATO (Campo/Quadra/Society por categoria)
// ---------------------------------------------------------------------
async function initFormatoTab() {
  document.getElementById('formato-categoria-label').innerText = adminCategoria === 'masculino' ? 'Masculino' : 'Feminino';
  try {
    const cfg = await fetchModalidade(adminCategoria);
    document.getElementById('formato-modalidade').value = cfg.modalidade;
    document.getElementById('formato-titulares').value = cfg.titulares;
    document.getElementById('formato-reservas').value = cfg.reservas;
  } catch (e) {
    console.error(e);
  }
}

async function saveFormato(e) {
  e.preventDefault();
  const modalidade = document.getElementById('formato-modalidade').value;
  const titulares = document.getElementById('formato-titulares').value;
  const reservas = document.getElementById('formato-reservas').value;
  try {
    await saveModalidade(adminCategoria, { modalidade, titulares, reservas });
    await loadMinJogadoresExigidos();
    alert('Formato salvo!');
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

// ---------------------------------------------------------------------
// EQUIPES + JOGADORES (formulário dinâmico)
// ---------------------------------------------------------------------
function addJogadorRow() {
  if (jogadoresPendentes.length >= MAX_JOGADORES_POR_EQUIPE) {
    alert(`O elenco pode ter no máximo ${MAX_JOGADORES_POR_EQUIPE} atletas.`);
    return;
  }
  const id = 'jr_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  jogadoresPendentes.push({ rowId: id, nome: '', numero: '', posicao: '', fotoFile: null, convidado: false });

  const list = document.getElementById('jogadores-list');
  const card = document.createElement('div');
  card.className = 'jogador-card';
  card.id = id;
  card.innerHTML = `
    <div class="jogador-card-header">
      <img class="jogador-card-avatar" id="prev_${id}" style="display:none;">
      <input type="text" class="form-control" style="flex:1;" placeholder="Nome do jogador" oninput="updateJogadorField('${id}','nome',this.value); refreshCapitaoOptions();">
    </div>
    <div class="jogador-card-row">
      <input type="number" class="form-control" placeholder="Número da camisa" oninput="updateJogadorField('${id}','numero',this.value)">
      <select class="form-control" onchange="updateJogadorField('${id}','posicao',this.value)">${opcoesPosicao('')}</select>
    </div>
    <div class="jogador-card-file">
      <label>Foto do jogador (opcional)</label>
      <input type="file" accept="image/*" class="form-control" onchange="handleJogadorFoto('${id}', this)">
    </div>
    <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;">
      <input type="checkbox" onchange="updateJogadorField('${id}','convidado',this.checked)"> 🌟 Atleta convidado (máx. 1 por equipe, conforme regulamento)
    </label>
    <div class="jogador-card-actions">
      <button type="button" class="btn-remove" onclick="removeJogadorRow('${id}')">✕ Remover esta linha</button>
    </div>
  `;
  list.appendChild(card);
  updateMinJogadoresNote();
}

function updateJogadorField(rowId, field, value) {
  const row = jogadoresPendentes.find(j => j.rowId === rowId);
  if (row) row[field] = value;
  if (field === 'nome') updateMinJogadoresNote();
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
  updateMinJogadoresNote();
  refreshCapitaoOptions();
}

async function saveTeam(e) {
  e.preventDefault();

  if (!editingTeamId) {
    const jogadoresValidosCheck = jogadoresPendentes.filter(j => j.nome && j.nome.trim());
    if (jogadoresValidosCheck.length < minJogadoresExigidos) {
      alert(`Faltam jogadores: cadastre pelo menos ${minJogadoresExigidos} (formato configurado em "Formato do Campeonato") antes de salvar a equipe. Você preencheu ${jogadoresValidosCheck.length}.`);
      return;
    }
    if (jogadoresValidosCheck.length > MAX_JOGADORES_POR_EQUIPE) {
      alert(`O elenco pode ter no máximo ${MAX_JOGADORES_POR_EQUIPE} atletas. Você preencheu ${jogadoresValidosCheck.length} — remova ${jogadoresValidosCheck.length - MAX_JOGADORES_POR_EQUIPE} linha(s) antes de salvar.`);
      return;
    }
    const numeroDup = numeroDuplicadoEntre(jogadoresValidosCheck);
    if (numeroDup !== null) {
      alert(`Dois ou mais atletas estão com a camisa nº ${numeroDup}. Corrija antes de salvar — cada número deve ser único dentro da equipe.`);
      return;
    }
    const convidados = jogadoresValidosCheck.filter(j => j.convidado).length;
    if (convidados > 1) {
      if (!confirm(`Você marcou ${convidados} jogadores como convidado, e o regulamento permite só 1 por equipe. Salvar mesmo assim?`)) return;
    }
  }

  const btn = document.getElementById('btn-salvar-equipe');
  btn.disabled = true;
  btn.textContent = editingTeamId ? 'Salvando alterações...' : 'Salvando...';

  try {
    const nome = document.getElementById('team-name').value;
    const presidente = document.getElementById('team-president').value;
    const capitao = document.getElementById('team-captain').value;
    const comissao_tecnica = document.getElementById('team-staff').value;
    const diretor_marketing = document.getElementById('team-marketing').value;
    const escudoFile = document.getElementById('team-escudo').files[0] || null;

    if (editingTeamId) {
      await updateTeam(editingTeamId, { nome, presidente, capitao, comissao_tecnica, diretor_marketing, escudoFile });
      alert('Equipe atualizada!');
      cancelEditTeam();
    } else {
      const jogadoresValidos = jogadoresPendentes.filter(j => j.nome && j.nome.trim());
      await createTeam({ nome, presidente, capitao, comissao_tecnica, diretor_marketing, categoria: adminCategoria, escudoFile, jogadores: jogadoresValidos });
      alert('Equipe cadastrada!');
      document.getElementById('form-team').reset();
      document.getElementById('escudo-preview').style.display = 'none';
      document.getElementById('jogadores-list').innerHTML = '';
      jogadoresPendentes = [];
      addJogadorRow();
    }

    teams = await fetchTeams(adminCategoria);
    renderAdminTeamsSummary();
    renderAdminTeamsList();
  } catch (err) {
    alert('Erro ao salvar equipe: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editingTeamId ? 'Salvar Alterações' : 'Salvar Equipe';
  }
}

function editTeam(teamId) {
  const t = teams.find(x => x.id === teamId);
  if (!t) return;
  editingTeamId = teamId;

  document.getElementById('team-name').value = t.nome;
  document.getElementById('team-president').value = t.presidente === 'A definir' ? '' : t.presidente;
  document.getElementById('team-staff').value = t.comissao_tecnica === 'A definir' ? '' : t.comissao_tecnica;
  document.getElementById('team-marketing').value = (t.diretor_marketing && t.diretor_marketing !== 'A definir') ? t.diretor_marketing : '';
  if (t.escudo_url) {
    document.getElementById('escudo-preview').src = t.escudo_url;
    document.getElementById('escudo-preview').style.display = 'block';
  }

  document.getElementById('btn-add-jogador-row').style.display = 'none';
  renderElencoEdicao(t);

  document.getElementById('btn-salvar-equipe').textContent = 'Salvar Alterações';
  document.getElementById('btn-cancelar-edicao').style.display = 'inline-block';
  document.getElementById('card-nova-equipe').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditTeam() {
  editingTeamId = null;
  document.getElementById('form-team').reset();
  document.getElementById('escudo-preview').style.display = 'none';
  document.getElementById('btn-add-jogador-row').style.display = 'inline-block';
  document.getElementById('jogadores-list').innerHTML = '';
  jogadoresPendentes = [];
  document.getElementById('team-captain').innerHTML = '<option value="">— Adicione jogadores para escolher —</option>';
  addJogadorRow();
  document.getElementById('btn-salvar-equipe').textContent = 'Salvar Equipe';
  document.getElementById('btn-cancelar-edicao').style.display = 'none';
}

// ---------------------------------------------------------------------
// EDITOR DE ELENCO (dentro do modo de edição de equipe)
// ---------------------------------------------------------------------
let elencoFotoPendente = {};

const LABEL_POSICAO = { PIVO: 'PIVÔ' };

function opcoesPosicao(selecionada) {
  return '<option value="">Posição</option>' + posicoesAtuais.map(p => `<option value="${p}" ${p === selecionada ? 'selected' : ''}>${LABEL_POSICAO[p] || p}</option>`).join('');
}

function renderElencoEdicao(t) {
  const list = document.getElementById('jogadores-list');
  const jogadores = t.jogadores || [];

  const existentesHtml = jogadores.map(j => `
    <div class="jogador-card">
      <div class="jogador-card-header">
        <img class="jogador-card-avatar" id="elprev_${j.id}" src="${j.foto_url || ''}" style="${j.foto_url ? '' : 'display:none;'}">
        <input type="text" class="form-control" style="flex:1;" id="el_nome_${j.id}" value="${j.nome}" placeholder="Nome">
      </div>
      <div class="jogador-card-row">
        <input type="number" class="form-control" id="el_numero_${j.id}" value="${j.numero ?? ''}" placeholder="Número da camisa">
        <select class="form-control" id="el_posicao_${j.id}">${opcoesPosicao(j.posicao)}</select>
      </div>
      <div class="jogador-card-file">
        <label>Trocar foto</label>
        <input type="file" accept="image/*" class="form-control" onchange="handleElencoFoto('${j.id}', this, 'elprev_${j.id}')">
      </div>
      <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;">
        <input type="checkbox" id="el_convidado_${j.id}" ${j.convidado ? 'checked' : ''}> 🌟 Atleta convidado
      </label>
      <div class="jogador-card-actions">
        <button type="button" class="btn-action" onclick="salvarJogadorExistente('${j.id}')">💾 Salvar Alterações</button>
        <button type="button" class="btn-remove" onclick="removerJogadorExistente('${j.id}')">✕ Remover</button>
      </div>
    </div>
  `).join('');

  const novoHtml = `
    <div class="jogador-card novo">
      <p style="color:var(--gold); font-size:0.78rem; font-weight:700; margin-bottom:10px;">➕ Novo jogador — preencha e cadastre</p>
      <div class="jogador-card-header">
        <img class="jogador-card-avatar" id="elprev_novo" style="display:none;">
        <input type="text" class="form-control" style="flex:1;" id="el_novo_nome" placeholder="Nome do novo jogador">
      </div>
      <div class="jogador-card-row">
        <input type="number" class="form-control" id="el_novo_numero" placeholder="Número da camisa">
        <select class="form-control" id="el_novo_posicao">${opcoesPosicao('')}</select>
      </div>
      <div class="jogador-card-file">
        <label>Foto (opcional)</label>
        <input type="file" accept="image/*" class="form-control" onchange="handleElencoFoto('novo', this, 'elprev_novo')">
      </div>
      <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;">
        <input type="checkbox" id="el_novo_convidado"> 🌟 Atleta convidado
      </label>
      <div class="jogador-card-actions">
        <button type="button" class="btn-action" onclick="adicionarNovoJogadorElenco()">✅ Cadastrar este Jogador no Elenco</button>
      </div>
    </div>
  `;

  atualizarSelectCapitao(t);

  list.innerHTML = `<p style="color:var(--text-muted); font-size:0.75rem; margin-bottom:8px;">${jogadores.length} jogador(es) no elenco.</p>` + existentesHtml + novoHtml;
}

function handleElencoFoto(key, input, previewId) {
  elencoFotoPendente[key] = input.files[0] || null;
  const preview = document.getElementById(previewId);
  if (elencoFotoPendente[key]) {
    preview.src = URL.createObjectURL(elencoFotoPendente[key]);
    preview.style.display = 'block';
  }
}

async function refreshElenco() {
  teams = await fetchTeams(adminCategoria);
  const t = teams.find(x => x.id === editingTeamId);
  if (t) renderElencoEdicao(t);
  renderAdminTeamsList();
}

async function salvarJogadorExistente(jogadorId) {
  const nome = document.getElementById(`el_nome_${jogadorId}`).value;
  const numero = document.getElementById(`el_numero_${jogadorId}`).value;
  const posicao = document.getElementById(`el_posicao_${jogadorId}`).value;
  const convidado = document.getElementById(`el_convidado_${jogadorId}`).checked;
  const fotoFile = elencoFotoPendente[jogadorId] || null;

  if (!nome.trim()) { alert('O nome do jogador não pode ficar em branco.'); return; }
  if (numeroJaUsadoNoElenco(editingTeamId, numero, jogadorId)) {
    alert(`Já existe outro atleta desta equipe usando a camisa nº ${numero}. Escolha um número diferente.`);
    return;
  }
  if (convidado && jaTemOutroConvidado(editingTeamId, jogadorId)) {
    if (!confirm('Essa equipe já tem outro atleta marcado como convidado, e o regulamento permite só 1 por equipe. Salvar mesmo assim?')) return;
  }

  try {
    await updateJogador(jogadorId, { nome, numero, posicao, fotoFile, convidado });
    elencoFotoPendente[jogadorId] = null;
    await refreshElenco();
  } catch (e) {
    alert('Erro ao salvar jogador: ' + e.message);
  }
}

function jaTemOutroConvidado(equipeId, excetoJogadorId) {
  const t = teams.find(x => x.id === equipeId);
  return (t?.jogadores || []).some(j => j.convidado && j.id !== excetoJogadorId);
}

// Verifica se algum outro atleta do elenco já usa este número de camisa.
// numero vazio/undefined não conflita com nada (número ainda não definido).
function numeroJaUsadoNoElenco(equipeId, numero, excetoJogadorId) {
  const num = (numero ?? '').toString().trim();
  if (num === '') return false;
  const t = teams.find(x => x.id === equipeId);
  return (t?.jogadores || []).some(j => j.id !== excetoJogadorId && (j.numero ?? '').toString().trim() === num);
}

async function removerJogadorExistente(jogadorId) {
  if (!confirm('Remover este jogador do elenco? Isso também apaga o histórico de escalação/eventos ligados a ele.')) return;
  try {
    await deleteJogador(jogadorId);
    await refreshElenco();
  } catch (e) {
    alert('Erro ao remover jogador: ' + e.message);
  }
}

async function adicionarNovoJogadorElenco() {
  const nome = document.getElementById('el_novo_nome').value;
  const numero = document.getElementById('el_novo_numero').value;
  const posicao = document.getElementById('el_novo_posicao').value;
  const convidado = document.getElementById('el_novo_convidado').checked;
  const fotoFile = elencoFotoPendente['novo'] || null;

  if (!nome.trim()) { alert('Informe o nome do jogador.'); return; }
  const t = teams.find(x => x.id === editingTeamId);
  if ((t?.jogadores || []).length >= MAX_JOGADORES_POR_EQUIPE) {
    alert(`Este elenco já tem ${MAX_JOGADORES_POR_EQUIPE} atletas, o máximo permitido. Remova alguém antes de adicionar um novo.`);
    return;
  }
  if (numeroJaUsadoNoElenco(editingTeamId, numero, null)) {
    alert(`Já existe um atleta desta equipe usando a camisa nº ${numero}. Escolha um número diferente.`);
    return;
  }
  if (convidado && jaTemOutroConvidado(editingTeamId, null)) {
    if (!confirm('Essa equipe já tem outro atleta marcado como convidado, e o regulamento permite só 1 por equipe. Salvar mesmo assim?')) return;
  }

  try {
    await addJogador(editingTeamId, { nome, numero, posicao, fotoFile, convidado });
    elencoFotoPendente['novo'] = null;
    await refreshElenco();
  } catch (e) {
    alert('Erro ao adicionar jogador: ' + e.message);
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
      <button class="btn-secondary" onclick="editTeam('${t.id}')">Editar</button>
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
  contusao: '🚑 Contusão',
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

    if (tipo === 'cartao_amarelo') {
      await avisarSeMultiploDeTresAmarelos(jogador_id);
    } else {
      alert('Ocorrência registrada!');
    }

    document.getElementById('form-evento').reset();
    toggleSuspensaoField();
    renderAdminEventosList();
  } catch (err) {
    alert('Erro ao registrar: ' + err.message);
  }
}

// Lembrete pro admin quando um atleta bate 3, 6, 9... cartões amarelos.
// Isso NÃO aplica suspensão automática nenhuma — o controle de suspensão
// continua 100% manual, é só um aviso pra organização não esquecer de
// avaliar o caso conforme o regulamento.
async function avisarSeMultiploDeTresAmarelos(jogadorId) {
  try {
    const eventosDoJogador = await fetchEventos({ jogadorId });
    const totalAmarelos = eventosDoJogador.filter(e => e.tipo === 'cartao_amarelo').length;
    if (totalAmarelos > 0 && totalAmarelos % 3 === 0) {
      const nomeJogador = eventosDoJogador[0]?.jogadores?.nome || 'Este atleta';
      alert(`🟨 Ocorrência registrada!\n\n⚠️ Atenção: ${nomeJogador} chegou a ${totalAmarelos} cartões amarelos. Avalie se cabe suspensão — o controle continua manual, nada é aplicado automaticamente.`);
    } else {
      alert('Ocorrência registrada!');
    }
  } catch (e) {
    console.error(e);
    alert('Ocorrência registrada!');
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

// ---------------------------------------------------------------------
// SÚMULA COMPLETA DE UMA PARTIDA
// ---------------------------------------------------------------------
async function openSumulaAdmin(matchId) {
  sumulaMatchId = matchId;
  const m = matches.find(x => x.id === matchId);
  if (!m) return;

  const tA = teams.find(t => t.id === m.equipe_a);
  const tB = teams.find(t => t.id === m.equipe_b);
  document.getElementById('sumula-admin-title').innerText = `${tA?.nome || '?'} × ${tB?.nome || '?'}`;
  document.getElementById('chk-prorrogacao').checked = !!m.teve_prorrogacao;
  document.getElementById('chk-penaltis').checked = !!m.teve_penaltis;
  document.getElementById('wrap-penaltis').style.display = m.teve_penaltis ? 'block' : 'none';

  document.getElementById('chk-ao-vivo').checked = m.status === 'LIVE';
  document.getElementById('wrap-placar-ao-vivo').style.display = m.status === 'LIVE' ? 'block' : 'none';
  document.getElementById('live-nome-a').innerText = tA?.nome || '';
  document.getElementById('live-nome-b').innerText = tB?.nome || '';
  document.getElementById('live-score-a').innerText = m.placar_a ?? 0;
  document.getElementById('live-score-b').innerText = m.placar_b ?? 0;
  document.getElementById('link-transmissao').value = m.link_transmissao || '';

  // Selects de equipe (gols, pênaltis)
  const equipeOptions = `<option value="${tA?.id}">${tA?.nome}</option><option value="${tB?.id}">${tB?.nome}</option>`;
  document.getElementById('gol-equipe').innerHTML = equipeOptions;
  document.getElementById('pen-equipe').innerHTML = equipeOptions;

  populateJogadoresDoSelect('gol-equipe', 'gol-jogador');
  populateJogadoresDoSelect('gol-equipe', 'gol-assistencia', true);
  populateJogadoresDoSelect('pen-equipe', 'pen-jogador');

  switchAdminScreen('sumula-admin');

  await Promise.all([
    renderAdminGolsList(),
    renderAdminPenaltisList(),
    renderEscalacaoTimes(tA, tB),
  ]);
}

function jogadoresDaEquipeSelecionada(selectEquipeId) {
  const equipeId = document.getElementById(selectEquipeId).value;
  return teams.find(t => t.id === equipeId)?.jogadores || [];
}

function populateJogadoresDoSelect(selectEquipeId, selectJogadorId, comOpcaoVazia) {
  const jogadores = jogadoresDaEquipeSelecionada(selectEquipeId);
  const opcoes = jogadores.map(j => `<option value="${j.id}">${j.numero ? '#' + j.numero + ' ' : ''}${j.nome}</option>`).join('');
  const vazio = comOpcaoVazia ? '<option value="">Sem assistência</option>' : '';
  document.getElementById(selectJogadorId).innerHTML = vazio + (opcoes || (comOpcaoVazia ? '' : '<option value="">Sem jogadores</option>'));
}

async function toggleAoVivoUI(checked) {
  try {
    await setMatchLive(sumulaMatchId, checked);
    document.getElementById('wrap-placar-ao-vivo').style.display = checked ? 'block' : 'none';
    const m = matches.find(x => x.id === sumulaMatchId);
    if (m) m.status = checked ? 'LIVE' : 'SCHEDULED';
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function ajustarPlacarAoVivo(lado, delta) {
  const spanId = lado === 'a' ? 'live-score-a' : 'live-score-b';
  const atual = parseInt(document.getElementById(spanId).innerText) || 0;
  const novo = Math.max(0, atual + delta);
  document.getElementById(spanId).innerText = novo;

  const scoreA = lado === 'a' ? novo : parseInt(document.getElementById('live-score-a').innerText) || 0;
  const scoreB = lado === 'b' ? novo : parseInt(document.getElementById('live-score-b').innerText) || 0;

  try {
    await updateLiveScore(sumulaMatchId, scoreA, scoreB);
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function salvarLinkTransmissaoUI() {
  const link = document.getElementById('link-transmissao').value;
  try {
    await saveLinkTransmissao(sumulaMatchId, link);
    alert('Link de transmissão salvo!');
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function toggleFlagUI(flag, checked) {
  try {
    await updatePartidaFlags(sumulaMatchId, { [flag]: checked });
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

function toggleWrap(id, show) {
  document.getElementById(id).style.display = show ? 'block' : 'none';
}

// --- Gols ---
async function addGolUI() {
  const equipe_id = document.getElementById('gol-equipe').value;
  const jogador_id = document.getElementById('gol-jogador').value;
  const assistencia_jogador_id = document.getElementById('gol-assistencia').value;
  const minuto = document.getElementById('gol-minuto').value;
  const tipo = document.getElementById('gol-tipo').value;
  if (!jogador_id) { alert('Selecione o jogador que marcou.'); return; }
  if (assistencia_jogador_id && assistencia_jogador_id === jogador_id) { alert('O jogador que marcou não pode ser o mesmo da assistência.'); return; }

  try {
    await createGol({ partida_id: sumulaMatchId, jogador_id, equipe_id, minuto, tipo, assistencia_jogador_id });
    document.getElementById('gol-minuto').value = '';
    document.getElementById('gol-assistencia').value = '';
    renderAdminGolsList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function renderAdminGolsList() {
  const container = document.getElementById('admin-gols-list');
  try {
    const gols = await fetchGols(sumulaMatchId);
    container.innerHTML = gols.map(g => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-top:1px solid var(--border-soft); font-size:0.85rem;">
        <span>⚽ ${g.marcador?.nome || '?'}${g.assistente?.nome ? ` <span style="color:var(--gold);">(assist: ${g.assistente.nome})</span>` : ''} <span style="color:var(--text-muted);">(${g.equipes?.nome || ''})${g.minuto ? ' — ' + g.minuto + "'" : ''}${g.tipo === 'prorrogacao' ? ' · PRO' : ''}</span></span>
        <button class="btn-remove" onclick="deleteGolUI('${g.id}')">✕</button>
      </div>
    `).join('') || '<p style="color:var(--text-muted); font-size:0.82rem;">Nenhum gol lançado.</p>';
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger-strong); font-size:0.82rem;">Erro: ${e.message}</p>`;
  }
}

async function deleteGolUI(id) {
  try { await deleteGol(id); renderAdminGolsList(); } catch (e) { alert('Erro: ' + e.message); }
}

// --- Pênaltis ---
async function addPenaltiUI() {
  const equipe_id = document.getElementById('pen-equipe').value;
  const jogador_id = document.getElementById('pen-jogador').value;
  const ordem = document.getElementById('pen-ordem').value;
  const convertido = document.getElementById('pen-convertido').checked;
  if (!jogador_id || !ordem) { alert('Preencha jogador e ordem da cobrança.'); return; }

  try {
    await createPenaltiCobranca({ partida_id: sumulaMatchId, equipe_id, jogador_id, ordem: parseInt(ordem), convertido });
    document.getElementById('pen-ordem').value = '';
    renderAdminPenaltisList();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

async function renderAdminPenaltisList() {
  const container = document.getElementById('admin-penaltis-list');
  try {
    const penaltis = await fetchPenaltis(sumulaMatchId);
    container.innerHTML = penaltis.map(p => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-top:1px solid var(--border-soft); font-size:0.85rem;">
        <span>${p.convertido ? '✅' : '❌'} #${p.ordem} ${p.jogadores?.nome || '?'} <span style="color:var(--text-muted);">(${p.equipes?.nome || ''})</span></span>
        <button class="btn-remove" onclick="deletePenaltiUI('${p.id}')">✕</button>
      </div>
    `).join('') || '<p style="color:var(--text-muted); font-size:0.82rem;">Nenhuma cobrança lançada.</p>';
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger-strong); font-size:0.82rem;">Erro: ${e.message}</p>`;
  }
}

async function deletePenaltiUI(id) {
  try { await deletePenaltiCobranca(id); renderAdminPenaltisList(); } catch (e) { alert('Erro: ' + e.message); }
}

// --- Escalação & Notas ---
// Limite fixo de titulares em campo ao mesmo tempo. Depois de atingido,
// entradas adicionais só entram como substituição (sem limite de trocas —
// quem sai pode retornar depois numa próxima substituição).
const MAX_TITULARES_EM_CAMPO = 5;

// Substituições são gravadas em eventos_disciplinares (tipo 'outro', não há
// coluna própria no banco pra isso) com um marcador reconhecível na
// descrição indicando quem SAIU — quem ENTROU já é o jogador_id do evento.
const SUB_MARK_REGEX = /^\[SUB\|saiu=([a-f0-9-]+)\]/;

function eventoESubstituicao(ev) {
  return ev.tipo === 'outro' && SUB_MARK_REGEX.test(ev.descricao || '');
}

function parseSubstituicao(ev) {
  const m = (ev.descricao || '').match(SUB_MARK_REGEX);
  return m ? { id: ev.id, entrouId: ev.jogador_id, saiuId: m[1], criadoEm: ev.created_at, minuto: ev.minuto } : null;
}

function substituicoesDoTime(equipeId, eventosDaPartida) {
  return eventosDaPartida
    .filter(ev => ev.equipe_id === equipeId && eventoESubstituicao(ev))
    .map(parseSubstituicao)
    .sort((a, b) => new Date(a.criadoEm) - new Date(b.criadoEm));
}

// Quem está em campo agora: titulares + substituições aplicadas em ordem.
function calcularEmCampo(equipeId, escalacaoDoTime, eventosDaPartida) {
  const emCampo = new Set(escalacaoDoTime.filter(e => e.titular).map(e => e.jogador_id));
  substituicoesDoTime(equipeId, eventosDaPartida).forEach(s => { emCampo.delete(s.saiuId); emCampo.add(s.entrouId); });
  return emCampo;
}

// Todo mundo que participou em algum momento (titular OU entrou por
// substituição) — só esses podem receber nota.
function calcularParticipantes(equipeId, escalacaoDoTime, eventosDaPartida) {
  const participantes = new Set(escalacaoDoTime.filter(e => e.titular).map(e => e.jogador_id));
  substituicoesDoTime(equipeId, eventosDaPartida).forEach(s => participantes.add(s.entrouId));
  return participantes;
}

async function renderEscalacaoTimes(tA, tB) {
  const container = document.getElementById('admin-escalacao-times');
  container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Carregando...</p>';

  const m = matches.find(x => x.id === sumulaMatchId);
  const partidaConcluida = m?.status === 'FINISHED';

  let escalacaoAtual = [];
  let eventosDaPartida = [];
  try {
    [escalacaoAtual, eventosDaPartida] = await Promise.all([
      fetchEscalacao(sumulaMatchId),
      fetchEventos({ partidaId: sumulaMatchId }),
    ]);
  } catch (e) { console.error(e); }

  const blocoTime = (t) => {
    if (!t) return '';
    const jogadores = t.jogadores || [];
    const escalacaoDoTime = escalacaoAtual.filter(e => e.equipe_id === t.id);
    const titularesCount = escalacaoDoTime.filter(e => e.titular).length;
    const emCampo = calcularEmCampo(t.id, escalacaoDoTime, eventosDaPartida);
    const participantes = calcularParticipantes(t.id, escalacaoDoTime, eventosDaPartida);
    const subs = substituicoesDoTime(t.id, eventosDaPartida);

    const linhasJogadores = jogadores.map(j => {
      const atual = escalacaoDoTime.find(e => e.jogador_id === j.id);
      const ehTitular = !!atual?.titular;
      // Trava a caixa de titular quando já tem 5 marcados e esta linha não é
      // um deles — força o uso da substituição pra colocar mais alguém.
      const desabilitarTitular = !ehTitular && titularesCount >= MAX_TITULARES_EM_CAMPO;
      const participou = participantes.has(j.id);
      const label = ehTitular ? '' : (emCampo.has(j.id) ? ' <span style="color:var(--gold-bright); font-size:0.7rem;">(em campo, substituto)</span>' : '');
      return `
        <div class="jogador-escalacao-linha" data-equipe-id="${t.id}" data-jogador-id="${j.id}" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-top:1px solid var(--border-soft);">
          <label style="display:flex; align-items:center; gap:4px; font-size:0.8rem; flex:1; ${desabilitarTitular ? 'opacity:0.45;' : ''}" title="${desabilitarTitular ? `Limite de ${MAX_TITULARES_EM_CAMPO} titulares atingido — use "Registrar substituição" pra colocar este jogador em campo.` : ''}">
            <input type="checkbox" id="tit_${j.id}" ${ehTitular ? 'checked' : ''} ${desabilitarTitular ? 'disabled' : ''} onchange="atualizarContadorTitulares('${t.id}')"> ${j.numero ? '#' + j.numero + ' ' : ''}${j.nome}${label}
          </label>
          <input type="number" id="nota_${j.id}" class="form-control" style="width:64px;" step="0.1" min="0" max="10" placeholder="Nota"
            value="${atual?.nota ?? ''}" ${(!partidaConcluida || !participou) ? 'disabled' : ''}
            title="${!partidaConcluida ? 'Nota liberada só depois que a partida for concluída.' : (!participou ? 'Este jogador não participou da partida.' : '')}">
        </div>
      `;
    }).join('') || '<p style="color:var(--text-muted); font-size:0.8rem;">Sem jogadores cadastrados.</p>';

    const bancoIds = jogadores.map(j => j.id).filter(id => !emCampo.has(id));
    const opcoesSai = jogadores.filter(j => emCampo.has(j.id))
      .map(j => `<option value="${j.id}">${j.numero ? '#' + j.numero + ' ' : ''}${j.nome}</option>`).join('');
    const opcoesEntra = jogadores.filter(j => bancoIds.includes(j.id))
      .map(j => `<option value="${j.id}">${j.numero ? '#' + j.numero + ' ' : ''}${j.nome}</option>`).join('');

    const historicoSubs = subs.length ? `
      <div style="margin-top:8px; font-size:0.75rem; color:var(--text-muted);">
        ${subs.map(s => {
          const nomeEntra = jogadores.find(j => j.id === s.entrouId)?.nome || '?';
          const nomeSai = jogadores.find(j => j.id === s.saiuId)?.nome || '?';
          return `<div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0;">
            <span>🔁 Entrou ${nomeEntra}, saiu ${nomeSai}${s.minuto ? ' aos ' + s.minuto + "'" : ''}</span>
            <button type="button" class="btn-remove" style="padding:2px 6px; font-size:0.7rem;" onclick="removerSubstituicaoUI('${s.id}')">✕</button>
          </div>`;
        }).join('')}
      </div>
    ` : '';

    return `
      <div style="margin-bottom:16px;" data-equipe-id="${t.id}">
        <p style="font-weight:700; margin-bottom:8px;">${t.nome} <span class="contador-titulares-${t.id}" style="color:var(--text-muted); font-weight:400; font-size:0.78rem;">(${titularesCount}/${MAX_TITULARES_EM_CAMPO} titulares)</span></p>
        ${linhasJogadores}
        <div style="margin-top:10px; padding:8px; background:var(--surface-high); border-radius:8px;">
          <p style="font-size:0.72rem; color:var(--text-muted); margin-bottom:6px;">🔁 Registrar substituição</p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <select id="sub_sai_${t.id}" class="form-control" style="font-size:0.8rem;">${opcoesSai || '<option value="">Ninguém em campo</option>'}</select>
            <select id="sub_entra_${t.id}" class="form-control" style="font-size:0.8rem;">${opcoesEntra || '<option value="">Banco vazio</option>'}</select>
          </div>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <input type="number" id="sub_minuto_${t.id}" class="form-control" placeholder="Minuto (opcional)" style="flex:1;">
            <button type="button" class="btn-secondary" style="flex-shrink:0;" onclick="registrarSubstituicaoUI('${t.id}')">Substituir</button>
          </div>
          ${historicoSubs}
        </div>
      </div>
    `;
  };

  container.innerHTML = blocoTime(tA) + blocoTime(tB) + `
    ${!partidaConcluida ? `<p style="color:var(--text-muted); font-size:0.78rem; margin-bottom:8px;">📌 As notas ficam liberadas depois que o placar da partida for salvo (status concluída), e só pra quem participou.</p>` : ''}
    <button class="btn-action" style="width:100%; margin-top:6px;" onclick="salvarEscalacaoCompleta()">💾 Salvar Escalação Completa</button>
  `;
}

function atualizarContadorTitulares(equipeId) {
  // Trabalha só com o DOM (sem recarregar do banco) pra não descartar
  // marcações de outros jogadores que o admin ainda não salvou.
  const linhas = document.querySelectorAll(`.jogador-escalacao-linha[data-equipe-id="${equipeId}"]`);
  let count = 0;
  linhas.forEach(l => { if (document.getElementById(`tit_${l.dataset.jogadorId}`)?.checked) count++; });

  document.querySelectorAll(`.contador-titulares-${equipeId}`).forEach(el => {
    el.textContent = el.textContent.replace(/^\(\d+/, `(${count}`);
  });

  // Trava caixas de titular ainda não marcadas quando o limite é atingido,
  // pra forçar o uso de "Registrar substituição" a partir daqui.
  linhas.forEach(l => {
    const chk = document.getElementById(`tit_${l.dataset.jogadorId}`);
    if (!chk || chk.checked) return;
    chk.disabled = count >= MAX_TITULARES_EM_CAMPO;
    const label = chk.closest('label');
    if (label) {
      label.style.opacity = chk.disabled ? '0.45' : '';
      label.title = chk.disabled ? `Limite de ${MAX_TITULARES_EM_CAMPO} titulares atingido — use "Registrar substituição" pra colocar este jogador em campo.` : '';
    }
  });
}

async function registrarSubstituicaoUI(equipeId) {
  const saiId = document.getElementById(`sub_sai_${equipeId}`).value;
  const entraId = document.getElementById(`sub_entra_${equipeId}`).value;
  const minuto = document.getElementById(`sub_minuto_${equipeId}`).value;

  if (!saiId || !entraId) { alert('Escolha quem sai e quem entra.'); return; }
  if (saiId === entraId) { alert('Escolha jogadores diferentes.'); return; }

  const t = teams.find(x => x.id === equipeId);
  const nomeSai = t?.jogadores?.find(j => j.id === saiId)?.nome || '?';
  const nomeEntra = t?.jogadores?.find(j => j.id === entraId)?.nome || '?';

  try {
    await createEvento({
      jogador_id: entraId,
      equipe_id: equipeId,
      partida_id: sumulaMatchId,
      tipo: 'outro',
      minuto,
      descricao: `[SUB|saiu=${saiId}] Substituição: entrou ${nomeEntra} no lugar de ${nomeSai}${minuto ? ' aos ' + minuto + "'" : ''}.`,
    });
    const m = matches.find(x => x.id === sumulaMatchId);
    const tA = teams.find(x => x.id === m?.equipe_a);
    const tB = teams.find(x => x.id === m?.equipe_b);
    await renderEscalacaoTimes(tA, tB);
  } catch (e) {
    alert('Erro ao registrar substituição: ' + e.message);
  }
}

async function removerSubstituicaoUI(eventoId) {
  if (!confirm('Remover esta substituição?')) return;
  try {
    await deleteEvento(eventoId);
    const m = matches.find(x => x.id === sumulaMatchId);
    const tA = teams.find(x => x.id === m?.equipe_a);
    const tB = teams.find(x => x.id === m?.equipe_b);
    await renderEscalacaoTimes(tA, tB);
  } catch (e) {
    alert('Erro ao remover substituição: ' + e.message);
  }
}

async function salvarEscalacaoCompleta() {
  const linhas = document.querySelectorAll('.jogador-escalacao-linha');
  if (!linhas.length) { alert('Nenhum jogador para salvar.'); return; }

  const m = matches.find(x => x.id === sumulaMatchId);
  const partidaConcluida = m?.status === 'FINISHED';

  try {
    // Recalcula participantes por equipe pra não gravar nota de quem não jogou,
    // mesmo que o campo de nota tenha ficado com algum valor residual.
    const eventosDaPartida = await fetchEventos({ partidaId: sumulaMatchId });
    const cacheParticipantes = {};

    await Promise.all(Array.from(linhas).map(l => {
      const jogadorId = l.dataset.jogadorId;
      const equipeId = l.dataset.equipeId;
      const titular = document.getElementById(`tit_${jogadorId}`).checked;

      if (!cacheParticipantes[equipeId]) {
        const escalacaoDoTime = Array.from(document.querySelectorAll(`.jogador-escalacao-linha[data-equipe-id="${equipeId}"]`))
          .map(el => ({ jogador_id: el.dataset.jogadorId, titular: document.getElementById(`tit_${el.dataset.jogadorId}`).checked }));
        cacheParticipantes[equipeId] = calcularParticipantes(equipeId, escalacaoDoTime, eventosDaPartida);
      }
      const participou = cacheParticipantes[equipeId].has(jogadorId);
      const nota = (partidaConcluida && participou) ? document.getElementById(`nota_${jogadorId}`).value : '';

      return saveEscalacaoJogador(sumulaMatchId, equipeId, jogadorId, { titular, nota });
    }));

    alert('Escalação completa salva!');
    const tA = teams.find(t => t.id === m?.equipe_a);
    const tB = teams.find(t => t.id === m?.equipe_b);
    await renderEscalacaoTimes(tA, tB);
  } catch (e) {
    alert('Erro ao salvar escalação: ' + e.message);
  }
}

const IDENTIDADE_PADRAO = { logo_torneio: null, patrocinador_master_logo: null, patrocinador_master_link: null };

async function initIdentidadeTab() {
  try {
    const cfg = await fetchConfig('identidade_visual', IDENTIDADE_PADRAO);
    if (cfg.logo_torneio) {
      document.getElementById('identidade-logo-preview').src = cfg.logo_torneio;
      document.getElementById('identidade-logo-preview').style.display = 'block';
    }
    if (cfg.patrocinador_master_logo) {
      document.getElementById('identidade-master-preview').src = cfg.patrocinador_master_logo;
      document.getElementById('identidade-master-preview').style.display = 'block';
    }
    document.getElementById('identidade-master-link').value = cfg.patrocinador_master_link || '';
  } catch (e) {
    console.error(e);
  }
}

async function saveIdentidadeVisual() {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const atual = await fetchConfig('identidade_visual', IDENTIDADE_PADRAO);
    const logoFile = document.getElementById('identidade-logo-torneio').files[0];
    const masterFile = document.getElementById('identidade-logo-master').files[0];

    const novo = {
      logo_torneio: logoFile ? await uploadImageToImgbb(logoFile) : atual.logo_torneio,
      patrocinador_master_logo: masterFile ? await uploadImageToImgbb(masterFile) : atual.patrocinador_master_logo,
      patrocinador_master_link: document.getElementById('identidade-master-link').value || null,
    };

    await saveConfig('identidade_visual', novo);
    alert('Identidade visual salva! Pode levar alguns segundos pra refletir no app público.');
  } catch (e) {
    alert('Erro ao salvar: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar Identidade Visual';
  }
}

const MODALIDADE_PADRAO_FALLBACK = { modalidade: 'campo', titulares: 11, reservas: 7 };

document.addEventListener('DOMContentLoaded', initAdmin);
