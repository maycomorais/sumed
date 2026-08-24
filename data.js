// =====================================================================
// data.js — Camada de acesso a dados (Supabase) — SUMED 2026
// Requer supabaseClient.js carregado antes.
// =====================================================================

// ---------------------------------------------------------------------
// Upload genérico de imagem. Retorna a URL pública ou lança erro.
// ---------------------------------------------------------------------
async function uploadImage(bucket, path, file) {
  const { error } = await sb.storage.from(bucket).upload(path, file, {
    upsert: true,
    cacheControl: '3600',
  });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function extensionOf(file) {
  const parts = file.name.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : 'jpg';
}

// ---------------------------------------------------------------------
// EQUIPES
// ---------------------------------------------------------------------
async function fetchTeams(categoria) {
  let query = sb
    .from('equipes')
    .select('id, nome, escudo_url, presidente, capitao, comissao_tecnica, diretor_marketing, categoria, jogadores(id, nome, numero, posicao, foto_url)')
    .order('nome');
  if (categoria) query = query.eq('categoria', categoria);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// escudoFile é opcional (File do <input type="file">)
async function createTeam({ nome, presidente, capitao, comissao_tecnica, diretor_marketing, categoria, escudoFile, jogadores }) {
  const { data: equipe, error } = await sb
    .from('equipes')
    .insert({
      nome,
      presidente: presidente || 'A definir',
      capitao: capitao || 'A definir',
      comissao_tecnica: comissao_tecnica || 'A definir',
      diretor_marketing: diretor_marketing || 'A definir',
      categoria: categoria || 'masculino',
    })
    .select()
    .single();
  if (error) throw error;

  if (escudoFile) {
    const path = `${equipe.id}.${extensionOf(escudoFile)}`;
    const url = await uploadImage('escudos', path, escudoFile);
    await sb.from('equipes').update({ escudo_url: url }).eq('id', equipe.id);
    equipe.escudo_url = url;
  }

  if (jogadores && jogadores.length) {
    for (const j of jogadores) {
      await addJogador(equipe.id, j);
    }
  }

  return equipe;
}

async function addJogador(equipeId, { nome, numero, posicao, fotoFile }) {
  const { data: jogador, error } = await sb
    .from('jogadores')
    .insert({ equipe_id: equipeId, nome, numero: numero || null, posicao: posicao || null })
    .select()
    .single();
  if (error) throw error;

  if (fotoFile) {
    const path = `${jogador.id}.${extensionOf(fotoFile)}`;
    const url = await uploadImage('jogadores', path, fotoFile);
    await sb.from('jogadores').update({ foto_url: url }).eq('id', jogador.id);
    jogador.foto_url = url;
  }
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
  const { data: sponsor, error } = await sb
    .from('patrocinadores')
    .insert({ nome, link: link || null, ordem: ordem || 0, logo_url: '' })
    .select()
    .single();
  if (error) throw error;

  const path = `${sponsor.id}.${extensionOf(logoFile)}`;
  const url = await uploadImage('patrocinadores', path, logoFile);
  await sb.from('patrocinadores').update({ logo_url: url }).eq('id', sponsor.id);
  sponsor.logo_url = url;
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
