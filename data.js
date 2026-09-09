// =====================================================================
// data.js — Camada de acesso a dados (Supabase) — SUMED 2026
// Requer supabaseClient.js carregado antes.
// =====================================================================

// ---------------------------------------------------------------------
// UPLOAD DE IMAGEM — ImgBB, com redimensionamento + conversão WebP
// ---------------------------------------------------------------------
// ⚠️ Esta chave fica exposta no código do cliente por natureza do ImgBB
// (não existe modo "server-only" nesse serviço). Se quiser trocar a
// chave, é só substituir a constante abaixo.
const IMGBB_API_KEY = 'd6ade30e77d706a440f7c03f08af33c4';

/**
 * Redimensiona (mantendo proporção) e converte pra WebP numa ÚNICA passagem
 * pelo canvas. Antes tínhamos duas conversões (redimensiona -> JPEG, depois
 * JPEG -> WebP), o que decodifica/recodifica a imagem duas vezes à toa —
 * mais lento e com perda de qualidade extra sem necessidade nenhuma.
 * @param {File} file
 * @param {Object} options
 * @param {number} options.maxWidth
 * @param {number} options.maxHeight
 * @param {number} options.quality - qualidade WebP, 0-100
 * @returns {Promise<Blob>}
 */
function resizeAndConvertToWebP(file, { maxWidth = 600, maxHeight = 600, quality = 70 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Falha ao carregar a imagem para processamento.'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

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
 * Envia uma imagem para o ImgBB — redimensiona e converte pra WebP antes,
 * pra manter upload rápido e arquivos pequenos (o gargalo de carregamento
 * do app era justamente subir/exibir fotos em resolução original).
 * @param {File} file
 * @param {Object} options
 * @param {number} options.maxWidth - padrão 600
 * @param {number} options.maxHeight - padrão 600
 * @param {number} options.quality - qualidade WebP 0-100, padrão 70
 * @returns {Promise<string>} URL da imagem no ImgBB
 */
async function uploadImageToImgbb(file, options = {}) {
  const { maxWidth = 600, maxHeight = 600, quality = 70 } = options;
  const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!tiposPermitidos.includes(file.type)) {
    throw new Error('Formato inválido. Use JPG, PNG, WEBP ou GIF.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Imagem muito grande. Máximo 10MB (limite do ImgBB).');
  }

  const webpBlob = await resizeAndConvertToWebP(file, { maxWidth, maxHeight, quality });

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
  const escudo_url = escudoFile ? await uploadImageToImgbb(escudoFile, { maxWidth: 300, maxHeight: 300 }) : null;

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
  const foto_url = fotoFile ? await uploadImageToImgbb(fotoFile, { maxWidth: 200, maxHeight: 200 }) : null;

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
// Monta o calendário completo (todos os jogos de todas as rodadas), de
// forma PURA (sem tocar no banco) — recebe a ordem já definida dos times
// (a ordem é o que determina os confrontos rodada a rodada no método do
// círculo). O time no índice 0 nunca roda de posição, então ele é sempre
// quem enfrenta o "BYE" (se houver) logo na Rodada 1 — é assim que
// conseguimos garantir uma equipe de folga forçada na primeira rodada.
function construirCalendarioRoundRobin(teamIdsOrdenados, categoria) {
  let teams = [...teamIdsOrdenados];
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

  return newMatches;
}

// Apaga TODO o calendário (todas as rodadas, placares, súmulas por
// cascata) de uma categoria, sem gerar um novo sorteio no lugar — é o
// "zerar sorteio" pedido pelo admin pra não precisar mexer direto no banco.
// Só apaga a categoria informada; a outra categoria fica intacta.
// ---------------------------------------------------------------------
// CONFIGURAÇÃO DO PRÉ-SORTEIO (folga forçada + pares restritos)
// ---------------------------------------------------------------------
// Fica salva no banco (não só em memória) porque quem CONFIGURA essas
// regras (AdminMaster) e quem EXECUTA o sorteio ao vivo (Presidente) podem
// estar em sessões/dispositivos diferentes — sem persistir, o Presidente
// nunca veria o que o AdminMaster configurou.
//
// Schema esperado (ajuste os nomes se o seu schema real for diferente):
//   tabela: sorteio_config
//   colunas: categoria (text, chave única) | folga_rodada1_id (uuid, null)
//            | pares_restritos (jsonb, default '[]')
async function carregarConfigSorteio(categoria) {
  const { data, error } = await sb
    .from('sorteio_config')
    .select('*')
    .eq('categoria', categoria)
    .maybeSingle();
  if (error) throw error;
  return {
    folgaRodada1Id: data?.folga_rodada1_id || null,
    paresRestritos: data?.pares_restritos || [],
  };
}

async function salvarConfigSorteio(categoria, { folgaRodada1Id, paresRestritos }) {
  const { error } = await sb.from('sorteio_config').upsert({
    categoria,
    folga_rodada1_id: folgaRodada1Id || null,
    pares_restritos: paresRestritos || [],
  });
  if (error) throw error;
}

async function zerarSorteio(categoria) {
  const { error } = await sb.from('partidas').delete().eq('categoria', categoria);
  if (error) throw error;
}

// Grava (substituindo) o calendário de uma categoria no banco. Separado de
// construirCalendarioRoundRobin pra podermos gerar/validar o calendário
// várias vezes em memória (retries de restrição, animação do sorteio) antes
// de decidir se ele vai ser realmente persistido.
async function salvarCalendario(categoria, newMatches) {
  const { error: deleteError } = await sb.from('partidas').delete().eq('categoria', categoria);
  if (deleteError) throw deleteError;

  const { error: insertError } = await sb.from('partidas').insert(newMatches);
  if (insertError) throw insertError;

  return newMatches;
}

// Algoritmo Round-Robin (Berger) — versão simples, sem restrições. Mantida
// por compatibilidade; o painel novo usa gerarCalendarioComRestricoes.
// allowedRoles é checado ANTES de chamar isto no admin.js, mas a garantia
// real é a RLS (partidas_insert/delete só admin_master/presidente).
// IMPORTANTE: o delete/insert abaixo é filtrado por categoria — gerar o
// sorteio do masculino NUNCA apaga as partidas do feminino, e vice-versa.
async function gerarSorteio(teamIds, categoria) {
  const newMatches = construirCalendarioRoundRobin(teamIds, categoria);
  return salvarCalendario(categoria, newMatches);
}

function embaralhar(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Confere se algum par "restrito" (que não pode se encontrar antes da
// Rodada 3) acabou caindo na Rodada 1 ou 2 desse calendário.
function calendarioRespeitaRestricoes(matches, paresRestritos) {
  if (!paresRestritos || !paresRestritos.length) return true;
  const chavesRestritas = new Set(paresRestritos.map(([a, b]) => [a, b].sort().join('|')));
  return matches.every(m => {
    if (m.is_bye || m.rodada > 2) return true;
    const chave = [m.equipe_a, m.equipe_b].sort().join('|');
    return !chavesRestritas.has(chave);
  });
}

// Gera um calendário completo respeitando:
//  - folgaRodada1Id: equipe que OBRIGATORIAMENTE folga na Rodada 1 (só faz
//    sentido/é aplicável quando o número de equipes é ímpar).
//  - paresRestritos: lista de pares [idA, idB] que não podem se enfrentar
//    nas Rodadas 1 e 2 (regra de "cabeças de chave" pedida pela organização).
// Estratégia: sorteia (embaralha) a ordem das demais equipes e testa; se
// alguma restrição cair nas 2 primeiras rodadas, sorteia de novo. Como a
// posição 0 nunca muda de lugar entre rodadas, colocar a equipe da folga
// nessa posição garante o efeito antes mesmo de checar as restrições.
function gerarCalendarioComRestricoes(teamIds, categoria, { folgaRodada1Id, paresRestritos = [], maxTentativas = 2000 } = {}) {
  const restantes = folgaRodada1Id ? teamIds.filter(id => id !== folgaRodada1Id) : [...teamIds];

  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    const ordenados = folgaRodada1Id ? [folgaRodada1Id, ...embaralhar(restantes)] : embaralhar(restantes);
    const matches = construirCalendarioRoundRobin(ordenados, categoria);
    if (calendarioRespeitaRestricoes(matches, paresRestritos)) {
      return matches;
    }
  }

  throw new Error('Não foi possível gerar um calendário respeitando todos os pares restritos configurados. Remova algum par ou tente novamente.');
}

async function saveMatchScore(matchId, scoreA, scoreB) {
  // Mesma trava do setMatchLive: se a partida já está com placar_travado,
  // não deixamos essa função reabrir o status (ex: limpar o placar voltaria
  // pra SCHEDULED). A UI já desabilita os campos quando travado, mas
  // garantimos aqui também, pra não depender só do front-end.
  const { data: atual, error: fetchError } = await sb
    .from('partidas')
    .select('placar_travado')
    .eq('id', matchId)
    .single();
  if (fetchError) throw fetchError;
  if (atual?.placar_travado) return; // nada a fazer — placar travado, ignora silenciosamente

  const payload = scoreA === '' || scoreB === ''
    ? { placar_a: null, placar_b: null, status: 'SCHEDULED' }
    : { placar_a: parseInt(scoreA), placar_b: parseInt(scoreB), status: 'FINISHED' };
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// W.O. (Art. 29º) — placar administrativo 3×0, sem coluna dedicada no
// banco. Guardamos um marcador reconhecível dentro de sumula_nota para
// conseguir contar ocorrências por equipe depois (ver contarOcorrenciasWO
// em admin.js). O placar_travado impede edição manual do placar na aba
// Placar depois de registrado.
const WO_MARK_PREFIX = '[WO|responsavel=';

async function registrarWO(matchId, equipeResponsavelId, equipeAId, equipeBId, notaExtra) {
  const placarResponsavel = 0;
  const placarAdversario = 3;
  const payload = {
    status: 'FINISHED',
    placar_travado: true,
    placar_a: equipeAId === equipeResponsavelId ? placarResponsavel : placarAdversario,
    placar_b: equipeBId === equipeResponsavelId ? placarResponsavel : placarAdversario,
    sumula_nota: `${WO_MARK_PREFIX}${equipeResponsavelId}] W.O. — equipe não esteve apta a iniciar a partida dentro da tolerância. Placar administrativo 3×0. Multa de 100.000 Gs aplicada.${notaExtra ? ' ' + notaExtra : ''}`,
  };
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

async function saveMatchMeta(matchId, { data, hora, local, rodada }) {
  const payload = {};
  if (data !== undefined) payload.data = data || null;
  if (hora !== undefined) payload.hora = hora || null;
  if (local !== undefined) payload.local = local || 'Campo Principal';
  if (rodada !== undefined) payload.rodada = Number(rodada);
  const { error } = await sb.from('partidas').update(payload).eq('id', matchId);
  if (error) throw error;
}

// Transfere uma partida para outra rodada (ex: adiamento por chuva, campo
// indisponível etc). Mantém o restante do calendário intacto — só move essa
// partida específica. Reaproveita saveMatchMeta pra também já poder ajustar
// data/hora/local nesse mesmo passo, já que normalmente andam juntos.
async function transferirPartidaDeRodada(matchId, novaRodada, { data, hora, local } = {}) {
  if (!novaRodada || Number(novaRodada) < 1) throw new Error('Informe uma rodada de destino válida.');
  await saveMatchMeta(matchId, { rodada: Number(novaRodada), data, hora, local });
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
  // Exibido a no máximo 150×64px (card de patrocinador) — 300px dá margem
  // de sobra pra telas retina sem carregar um arquivo desnecessariamente grande.
  const logo_url = await uploadImageToImgbb(logoFile, { maxWidth: 300, maxHeight: 300 });

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
    const url = await uploadImageToImgbb(escudoFile, { maxWidth: 300, maxHeight: 300 });
    await sb.from('equipes').update({ escudo_url: url }).eq('id', teamId);
    return url;
  }
  return null;
}

// ---------------------------------------------------------------------
// EXCLUSÃO DE EQUIPE
// ---------------------------------------------------------------------
// Exclui a equipe e tudo que depende diretamente dela: partidas em que ela
// jogou (nessa categoria), jogadores do elenco e as escalações que
// referenciam esses jogadores/essa equipe. Gols e eventos disciplinares
// ficam a cargo do ON DELETE CASCADE das FKs em jogadores/partidas — se o
// banco não tiver essa cascata configurada, ajuste aqui antes de usar em
// produção. A ordem importa: dependentes primeiro, equipe por último.
async function deleteTeam(teamId) {
  // 1) escalações que citam a equipe diretamente
  await sb.from('escalacoes').delete().eq('equipe_id', teamId);

  // 2) jogadores do elenco (e suas escalações/gols/eventos, via cascade)
  const { error: jogadoresError } = await sb.from('jogadores').delete().eq('equipe_id', teamId);
  if (jogadoresError) throw jogadoresError;

  // 3) partidas em que a equipe participou (como mandante ou visitante)
  const { error: partidasAError } = await sb.from('partidas').delete().eq('equipe_a', teamId);
  if (partidasAError) throw partidasAError;
  const { error: partidasBError } = await sb.from('partidas').delete().eq('equipe_b', teamId);
  if (partidasBError) throw partidasBError;

  // 4) a equipe em si
  const { error } = await sb.from('equipes').delete().eq('id', teamId);
  if (error) throw error;
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
    .select('jogador_id, equipe_id, tipo, partida_id, partidas!inner(categoria)')
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
    const url = await uploadImageToImgbb(fotoFile, { maxWidth: 200, maxHeight: 200 });
    await sb.from('jogadores').update({ foto_url: url }).eq('id', jogadorId);
  }
}

// ---------------------------------------------------------------------
// TRANSMISSÃO AO VIVO
// ---------------------------------------------------------------------
async function setMatchLive(matchId, aoVivo) {
  // Trava de segurança: uma partida com placar_travado (encerrada oficialmente
  // ou fechada por W.O.) nunca pode voltar para LIVE/SCHEDULED por aqui — sem
  // essa checagem, religar o toggle "Ao Vivo" reabria uma partida já encerrada.
  const { data: atual, error: fetchError } = await sb
    .from('partidas')
    .select('placar_travado')
    .eq('id', matchId)
    .single();
  if (fetchError) throw fetchError;
  if (atual?.placar_travado) {
    throw new Error('Esta partida já foi encerrada e o placar está travado — não é possível reabri-la.');
  }

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
// ---------------------------------------------------------------------
// DATA/LOCAL EM LOTE PARA TODA A RODADA
// ---------------------------------------------------------------------
// Aplica data, hora e/ou local de uma vez só pra rodada inteira — pensado
// pra tornar o cadastro bem mais rápido quando todos os jogos da rodada
// são no mesmo lugar/dia (qualquer campo omitido não é alterado).
async function bulkSetRoundInfo(categoria, rodada, { data, hora, local } = {}) {
  const payload = {};
  if (data !== undefined) payload.data = data || null;
  if (hora !== undefined) payload.hora = hora || null;
  if (local !== undefined && local !== '') payload.local = local;
  if (Object.keys(payload).length === 0) return;

  const { error } = await sb
    .from('partidas')
    .update(payload)
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
