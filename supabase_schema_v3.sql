-- =====================================================================
-- SUMED 2026 — Migração v3: Disciplina (cartões, contusões, punições)
-- Rode DEPOIS de supabase_schema.sql e supabase_schema_v2.sql.
-- =====================================================================

create table if not exists public.eventos_disciplinares (
  id uuid primary key default gen_random_uuid(),
  jogador_id uuid not null references public.jogadores(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  partida_id text references public.partidas(id) on delete set null, -- opcional: punição administrativa pode não ter partida
  tipo text not null check (tipo in ('cartao_amarelo', 'cartao_vermelho', 'contusao', 'punicao', 'suspensao', 'outro')),
  minuto int,
  descricao text,
  rodada_suspensao int, -- só usado quando tipo = 'suspensao': indica em qual rodada o jogador cumpre
  cumprida boolean default false, -- controle manual: organização marca quando a suspensão foi cumprida
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.eventos_disciplinares enable row level security;

-- Leitura pública (súmula e estatísticas do jogador aparecem no app público)
create policy "eventos_select_public" on public.eventos_disciplinares
  for select using (true);

-- Lançamento: os três papéis, igual ao lançamento de placar.
create policy "eventos_write" on public.eventos_disciplinares
  for all
  using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'))
  with check (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));

create index if not exists idx_eventos_jogador on public.eventos_disciplinares(jogador_id);
create index if not exists idx_eventos_partida on public.eventos_disciplinares(partida_id);
