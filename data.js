// =====================================================================
// data.js — Camada de acesso a dados (Supabase) — SUMED 2026
// Requer supabaseClient.js carregado antes.
// =====================================================================

// ---------------------------------------------------------------------
// UPLOAD DE IMAGEM — ImgBB (com conversão para WebP antes do envio)
// ---------------------------------------------------------------------
// ⚠️ Esta chave fica exposta no código do cliente por natureza do ImgBB
// (não existe modo "server-only" nesse serviço). Se quiser trocar a
// chave, é só substituir a constante abaixo.
const IMGBB_API_KEY = 'd6ade30e77d706a440f7c03f08af33c4';

function convertToWebP(file, quality = 80) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Falha ao carregar a imagem para conversão.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao converter imagem para WebP.'))),
          'image/webp',
          quality / 100
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Envia uma imagem para o ImgBB (convertendo para WebP antes) e retorna a URL direta.
 * @param {File} file
 * @param {number} quality - Qualidade WebP (0-100), padrão 80
 * @returns {Promise<string>}
 */
async function uploadImageToImgbb(file, quality = 80) {
  const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!tiposPermitidos.includes(file.type)) {
    throw new Error('Formato inválido. Use JPG, PNG, WEBP ou GIF.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Imagem muito grande. Máximo 10MB (limite do ImgBB).');
  }

  const webpBlob = await convertToWebP(file, quality);

  const formData = new FormData();
  formData.append('key', IMGBB_API_KEY);
  formData.append('image', webpBlob, 'image.webp');
  formData.append('name', file.name.replace(/\.[^.]+$/, '.webp'));

  const response = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`ImgBB: ${data.error?.message || 'Erro desconhecido'}`);
  }

  return data.data.url;
}

// ---------------------------------------------------------------------
// EQUIPES
// ---------------------------------------------------------------------
async function fetchTeams(categoria) {
  let query = sb
    .from('equipes')
    .select('id, nome, escudo_url, presidente, capitao, comissao_tecnica, diretor_marketing, categoria, jogadores(id, nome, numero, posicao, foto_url, convidado)')
    .order('nome');
  if (categoria) query = query.eq('categoria', categoria);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// escudoFile é opcional (File do <input type="file">)
async function createTeam({ nome, presidente, capitao, comissao_tecnica, diretor_marketing, categoria, escudoFile, jogadores }) {
  const escudo_url = escudoFile ? await uploadImageToImgbb(escudoFile) : null;

  const { data: equipe, error } = await sb
    .from('equipes')
    .insert({
      nome,
      presidente: presidente || 'A definir',
      capitao: capitao || 'A definir',
      comissao_tecnica: comissao_tecnica || 'A definir',
      diretor_marketing: diretor_marketing || 'A definir',
      categoria: categoria || 'masculino',
      escudo_url,
    })
    .select()
    .single();
  if (error) throw error;

  if (jogadores && jogadores.length) {
    for (const j of jogadores) {
      await addJogador(equipe.id, j);
    }
  }

  return equipe;
}

async function addJogador(equipeId, { nome, numero, posicao, fotoFile, convidado }) {
  const foto_url = fotoFile ? await uploadImageToImgbb(fotoFile) : null;

  const { data: jogador, error } = await sb
    .from('jogadores')
    .insert({ equipe_id: equipeId, nome, numero: numero || null, posicao: posicao || null, foto_url, convidado: !!convidado })
    .select()
    .single();
  if (error) throw error;
  return jogador;
}

async function deleteJogador(jogadorId) {
  const { error } = await sb.from('jogadores').delete().eq('id', jogadorId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// PARTIDAS
// ---------------------------------------------------------------------
async function fetchMatches(categoria) {
  let query = sb.from('partidas').select('*').order('rodada');
  if (categoria) query = query.eq('categoria', categoria);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Algoritmo Round-Robin (Berger) — igual ao anterior, agora grava no Supabase.
// allowedRoles é checado ANTES de chamar isto no admin.js, mas a garantia
// real é a RLS (partidas_insert/delete só admin_master/presidente).
// IMPORTANTE: o delete/insert abaixo é filtrado por categoria — gerar o
// sorteio do masculino NUNCA apaga as partidas do feminino, e vice-versa.
async function gerarSorteio(teamIds, categoria) {
  let teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push('BYE');

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  const matchesPerRound = numTeams / 2;
  const newMatches = [];

  for (let round = 0; round < numRounds; round++) {
    for (let match = 0; match < matchesPerRound; match++) {
      const home = teams[match];
      const away = teams[numTeams - 1 - match];

      if (home !== 'BYE' && away !== 'BYE') {
        newMatches.push({
          id: `m_${categoria}_${round + 1}_${match}`,
          rodada: round + 1,
          categoria,
          equipe_a: home,
          equipe_b: away,
          status: 'SCHEDULED',
          local: 'Campo Principal',
          is_bye: false,
        });
      } else {
        const realTeam = home === 'BYE' ? away : home;
        newMatches.push({
          id: `m_${categoria}_${round + 1}_bye`,
          rodada: round + 1,
          categoria,
          equipe_a: realTeam,
          equipe_b: null,
          is_bye: true,
        });
      }
    }
    teams.splice(1, 0, teams.pop());
  }

  // Apaga só o calendário anterior DESSA categoria e grava o novo (RLS
  // garante que só admin_master/presidente conseguem executar delete/insert).
  const { error: deleteError } = await sb.from('partidas').delete().eq('categoria', categoria);
  if (deleteError) throw deleteError;

  const { error: insertError } = await sb.from('partidas').insert(newMatches);
  if (insertError) throw insertError;

  return newMatches;
}

async function saveMatchScore(matchId, scoreA, scoreB) {
  const payload = scoreA === '' || scoreB === ''
    ? { placar_a: null, placar_b: null, status: 'SCHEDULED' }
    : { placar_a: parseInt(scoreA), placar_b: parseInt(scoreB), status: 'FINISHED' };
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

async function saveMatchMeta(matchId, { data, hora, local }) {
  const payload = {};
  if (data !== undefined) payload.data = data || null;
  if (hora !== undefined) payload.hora = hora || null;
  if (local !== undefined) payload.local = local || 'Campo Principal';
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// PATROCINADORES
// ---------------------------------------------------------------------
async function fetchSponsors() {
  const { data, error } = await sb
    .from('patrocinadores')
    .select('*')
    .eq('ativo', true)
    .order('ordem');
  if (error) throw error;
  return data;
}

async function fetchAllSponsors() {
  const { data, error } = await sb.from('patrocinadores').select('*').order('ordem');
  if (error) throw error;
  return data;
}

async function createSponsor({ nome, link, ordem, logoFile }) {
  const logo_url = await uploadImageToImgbb(logoFile);

  const { data: sponsor, error } = await sb
    .from('patrocinadores')
    .insert({ nome, link: link || null, ordem: ordem || 0, logo_url })
    .select()
    .single();
  if (error) throw error;
  return sponsor;
}

async function toggleSponsor(id, ativo) {
  const { error } = await sb.from('patrocinadores').update({ ativo }).eq('id', id);
  if (error) throw error;
}

async function deleteSponsor(id) {
  const { error } = await sb.from('patrocinadores').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// CONFIGURAÇÕES (regulamento etc.)
// ---------------------------------------------------------------------
async function fetchConfig(chave, fallback) {
  const { data, error } = await sb.from('configuracoes').select('valor').eq('chave', chave).maybeSingle();
  if (error) throw error;
  return data ? data.valor : fallback;
}

async function saveConfig(chave, valor) {
  const { error } = await sb.from('configuracoes').upsert({ chave, valor, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// EVENTOS DISCIPLINARES (cartões, contusões, punições, suspensões)
// ---------------------------------------------------------------------
async function fetchEventos({ partidaId, jogadorId, equipeId } = {}) {
  let query = sb
    .from('eventos_disciplinares')
    .select('*, jogadores(nome, equipe_id), equipes(nome)')
    .order('created_at', { ascending: false });

  if (partidaId) query = query.eq('partida_id', partidaId);
  if (jogadorId) query = query.eq('jogador_id', jogadorId);
  if (equipeId) query = query.eq('equipe_id', equipeId);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function createEvento({ jogador_id, equipe_id, partida_id, tipo, minuto, descricao, rodada_suspensao }) {
  const { data, error } = await sb
    .from('eventos_disciplinares')
    .insert({
      jogador_id,
      equipe_id,
      partida_id: partida_id || null,
      tipo,
      minuto: minuto || null,
      descricao: descricao || null,
      rodada_suspensao: tipo === 'suspensao' ? (rodada_suspensao || null) : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function toggleEventoCumprida(id, cumprida) {
  const { error } = await sb.from('eventos_disciplinares').update({ cumprida }).eq('id', id);
  if (error) throw error;
}

async function deleteEvento(id) {
  const { error } = await sb.from('eventos_disciplinares').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// EDIÇÃO DE EQUIPE
// ---------------------------------------------------------------------
async function updateTeam(teamId, { nome, presidente, capitao, comissao_tecnica, diretor_marketing, escudoFile }) {
  const payload = { nome, presidente, capitao, comissao_tecnica, diretor_marketing };
  const { error } = await sb.from('equipes').update(payload).eq('id', teamId);
  if (error) throw error;

  if (escudoFile) {
    const url = await uploadImageToImgbb(escudoFile);
    await sb.from('equipes').update({ escudo_url: url }).eq('id', teamId);
    return url;
  }
  return null;
}

// ---------------------------------------------------------------------
// FORMATO DO CAMPEONATO (Campo/Quadra/Society) POR CATEGORIA
// ---------------------------------------------------------------------
const MODALIDADE_PADRAO = { modalidade: 'campo', titulares: 11, reservas: 7 };

async function fetchModalidade(categoria) {
  return fetchConfig(`modalidade_${categoria}`, MODALIDADE_PADRAO);
}

async function saveModalidade(categoria, { modalidade, titulares, reservas }) {
  await saveConfig(`modalidade_${categoria}`, { modalidade, titulares: Number(titulares), reservas: Number(reservas) });
}

// ---------------------------------------------------------------------
// ESCALAÇÃO (titular/reserva + nota)
// ---------------------------------------------------------------------
async function fetchEscalacao(partidaId) {
  const { data, error } = await sb
    .from('escalacoes')
    .select('*, jogadores(nome, numero, posicao, foto_url, convidado)')
    .eq('partida_id', partidaId);
  if (error) throw error;
  return data;
}

async function saveEscalacaoJogador(partidaId, equipeId, jogadorId, { titular, nota }) {
  const { error } = await sb.from('escalacoes').upsert({
    partida_id: partidaId,
    equipe_id: equipeId,
    jogador_id: jogadorId,
    titular,
    nota: nota === '' || nota === null || nota === undefined ? null : Number(nota),
  }, { onConflict: 'partida_id,jogador_id' });
  if (error) throw error;
}

async function removeEscalacaoJogador(partidaId, jogadorId) {
  const { error } = await sb.from('escalacoes').delete().eq('partida_id', partidaId).eq('jogador_id', jogadorId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// GOLS
// ---------------------------------------------------------------------
async function fetchGols(partidaId) {
  const { data, error } = await sb
    .from('gols')
    .select('*, marcador:jogador_id(nome), assistente:assistencia_jogador_id(nome), equipes(nome)')
    .eq('partida_id', partidaId)
    .order('minuto');
  if (error) throw error;
  return data;
}

async function createGol({ partida_id, jogador_id, equipe_id, minuto, tipo, assistencia_jogador_id }) {
  const { error } = await sb.from('gols').insert({
    partida_id, jogador_id, equipe_id, minuto: minuto || null, tipo: tipo || 'normal',
    assistencia_jogador_id: assistencia_jogador_id || null,
  });
  if (error) throw error;
}

async function deleteGol(id) {
  const { error } = await sb.from('gols').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// PRORROGAÇÃO / PÊNALTIS
// ---------------------------------------------------------------------
async function updatePartidaFlags(matchId, { teve_prorrogacao, teve_penaltis }) {
  const payload = {};
  if (teve_prorrogacao !== undefined) payload.teve_prorrogacao = teve_prorrogacao;
  if (teve_penaltis !== undefined) payload.teve_penaltis = teve_penaltis;
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

async function fetchPenaltis(partidaId) {
  const { data, error } = await sb
    .from('penaltis_cobrancas')
    .select('*, jogadores(nome), equipes(nome)')
    .eq('partida_id', partidaId)
    .order('ordem');
  if (error) throw error;
  return data;
}

async function createPenaltiCobranca({ partida_id, equipe_id, jogador_id, ordem, convertido }) {
  const { error } = await sb.from('penaltis_cobrancas').insert({
    partida_id, equipe_id, jogador_id, ordem, convertido,
  });
  if (error) throw error;
}

async function deletePenaltiCobranca(id) {
  const { error } = await sb.from('penaltis_cobrancas').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// SELEÇÃO DA RODADA / PERNAS DE PAU (calculado a partir das notas)
// ---------------------------------------------------------------------
// Retorna todas as escalações com nota, de todas as partidas de uma
// categoria, já com jogador/posição/equipe/rodada — a agregação por
// rodada (melhor por posição, pior geral) é feita no cliente (index.js),
// já que o volume de dados é pequeno o suficiente pra não precisar de
// uma view SQL dedicada.
async function fetchEscalacoesDaCategoria(categoria) {
  const { data, error } = await sb
    .from('escalacoes')
    .select('*, jogadores(nome, posicao, foto_url, convidado), equipes(nome, categoria), partidas!inner(rodada, categoria, equipe_a, equipe_b, placar_a, placar_b)')
    .not('nota', 'is', null)
    .eq('partidas.categoria', categoria);
  if (error) throw error;
  return data;
}

async function fetchGolsDaCategoria(categoria) {
  const { data, error } = await sb
    .from('gols')
    .select('jogador_id, assistencia_jogador_id, equipe_id, partida_id, partidas!inner(categoria)')
    .eq('partidas.categoria', categoria);
  if (error) throw error;
  return data;
}

async function fetchEventosDaCategoria(categoria) {
  const { data, error } = await sb
    .from('eventos_disciplinares')
    .select('jogador_id, tipo, partida_id, partidas!inner(categoria)')
    .eq('partidas.categoria', categoria);
  if (error) throw error;
  return data;
}

async function updateJogador(jogadorId, { nome, numero, posicao, fotoFile, convidado }) {
  const payload = {};
  if (nome !== undefined) payload.nome = nome;
  if (numero !== undefined) payload.numero = numero === '' ? null : Number(numero);
  if (posicao !== undefined) payload.posicao = posicao || null;
  if (convidado !== undefined) payload.convidado = !!convidado;
  const { error } = await sb.from('jogadores').update(payload).eq('id', jogadorId);
  if (error) throw error;

  if (fotoFile) {
    const url = await uploadImageToImgbb(fotoFile);
    await sb.from('jogadores').update({ foto_url: url }).eq('id', jogadorId);
  }
}

// ---------------------------------------------------------------------
// TRANSMISSÃO AO VIVO
// ---------------------------------------------------------------------
async function setMatchLive(matchId, aoVivo) {
  const payload = { status: aoVivo ? 'LIVE' : 'SCHEDULED' };
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

async function finalizarPartidaAoVivo(matchId) {
  const { error } = await sb.from('partidas').update({ status: 'FINISHED' }).eq('id', matchId);
  if (error) throw error;
}

async function saveLinkTransmissao(matchId, link) {
  const { error } = await sb.from('partidas').update({ link_transmissao: link || null }).eq('id', matchId);
  if (error) throw error;
}

// Atualiza só o placar, sem mexer no status — usado durante o "Ao Vivo",
// onde o status continua 'LIVE' mesmo com placar mudando gol a gol.
async function updateLiveScore(matchId, scoreA, scoreB) {
  const { error } = await sb.from('partidas').update({ placar_a: scoreA, placar_b: scoreB }).eq('id', matchId);
  if (error) throw error;
}

async function fetchLiveMatch(categoria) {
  const { data, error } = await sb
    .from('partidas')
    .select('*')
    .eq('categoria', categoria)
    .eq('status', 'LIVE')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Assina atualizações em tempo real de UMA partida. Retorna o channel —
// guarde a referência e chame sb.removeChannel(channel) ao desmontar.
function subscribeToMatch(matchId, onUpdate) {
  return sb
    .channel(`partida-${matchId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'partidas', filter: `id=eq.${matchId}` }, (payload) => onUpdate(payload.new))
    .subscribe();
}

// Assina INSERTs de gols e eventos disciplinares de UMA partida — usado
// pelas animações do widget ao vivo (bola subindo, cartão subindo etc.)
function subscribeToMatchEvents(matchId, { onGol, onCartao } = {}) {
  return sb
    .channel(`eventos-${matchId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gols', filter: `partida_id=eq.${matchId}` }, (payload) => onGol && onGol(payload.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_disciplinares', filter: `partida_id=eq.${matchId}` }, (payload) => onCartao && onCartao(payload.new))
    .subscribe();
}

// ---------------------------------------------------------------------
// ENCERRAR PARTIDA (trava o placar — cartões/gols/assistência seguem editáveis)
// ---------------------------------------------------------------------
async function encerrarPartida(matchId) {
  const { error } = await sb.from('partidas').update({ status: 'FINISHED', placar_travado: true }).eq('id', matchId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// ARTILHEIROS E ASSISTÊNCIAS (agregado a partir da tabela gols)
// ---------------------------------------------------------------------
async function fetchArtilheiros(categoria, limite = 10) {
  const { data, error } = await sb
    .from('gols')
    .select('jogador_id, jogadores!gols_jogador_id_fkey(nome, foto_url), equipes(nome), partidas!inner(categoria)')
    .eq('partidas.categoria', categoria);
  if (error) throw error;

  const contagem = {};
  data.forEach(g => {
    if (!g.jogador_id) return;
    if (!contagem[g.jogador_id]) contagem[g.jogador_id] = { jogador_id: g.jogador_id, nome: g.jogadores?.nome, foto_url: g.jogadores?.foto_url, equipe: g.equipes?.nome, gols: 0 };
    contagem[g.jogador_id].gols++;
  });
  return Object.values(contagem).sort((a, b) => b.gols - a.gols).slice(0, limite);
}

async function fetchAssistencias(categoria, limite = 10) {
  const { data, error } = await sb
    .from('gols')
    .select('assistencia_jogador_id, assistente:assistencia_jogador_id(nome, foto_url), equipes(nome), partidas!inner(categoria)')
    .eq('partidas.categoria', categoria)
    .not('assistencia_jogador_id', 'is', null);
  if (error) throw error;

  const contagem = {};
  data.forEach(g => {
    const id = g.assistencia_jogador_id;
    if (!contagem[id]) contagem[id] = { jogador_id: id, nome: g.assistente?.nome, foto_url: g.assistente?.foto_url, equipe: g.equipes?.nome, assistencias: 0 };
    contagem[id].assistencias++;
  });
  return Object.values(contagem).sort((a, b) => b.assistencias - a.assistencias).slice(0, limite);
}

// ---------------------------------------------------------------------
// DATA EM LOTE PARA TODA A RODADA
// ---------------------------------------------------------------------
async function bulkSetRoundDate(categoria, rodada, data) {
  const { error } = await sb
    .from('partidas')
    .update({ data: data || null })
    .eq('categoria', categoria)
    .eq('rodada', rodada)
    .eq('is_bye', false);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// ESTATÍSTICAS DE UM JOGADOR (modal de perfil)
// ---------------------------------------------------------------------
async function fetchJogadorStats(jogadorId) {
  const [golsRes, assistRes, eventosRes, escalacaoRes] = await Promise.all([
    sb.from('gols').select('id', { count: 'exact', head: true }).eq('jogador_id', jogadorId),
    sb.from('gols').select('id', { count: 'exact', head: true }).eq('assistencia_jogador_id', jogadorId),
    sb.from('eventos_disciplinares').select('tipo').eq('jogador_id', jogadorId),
    sb.from('escalacoes').select('nota').eq('jogador_id', jogadorId).not('nota', 'is', null),
  ]);
  if (golsRes.error) throw golsRes.error;
  if (assistRes.error) throw assistRes.error;
  if (eventosRes.error) throw eventosRes.error;
  if (escalacaoRes.error) throw escalacaoRes.error;

  const eventos = eventosRes.data || [];
  const notas = (escalacaoRes.data || []).map(e => Number(e.nota));
  const mediaNota = notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null;

  return {
    gols: golsRes.count || 0,
    assistencias: assistRes.count || 0,
    cartaoAmarelo: eventos.filter(e => e.tipo === 'cartao_amarelo').length,
    cartaoVermelho: eventos.filter(e => e.tipo === 'cartao_vermelho').length,
    lesoes: eventos.filter(e => e.tipo === 'contusao').length,
    mediaNota,
    jogosAvaliados: notas.length,
  };
}
