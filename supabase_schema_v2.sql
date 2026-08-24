-- =====================================================================
-- SUMED 2026 — Migração v2
-- Rode DEPOIS do supabase_schema.sql original.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GERAR SORTEIO = operação destrutiva (apaga e recria partidas em
-- massa). Restringimos INSERT/DELETE em partidas a AdminMaster/Presidente.
-- UPDATE continua liberado pros três papéis (editar placar/data/hora
-- de UMA partida existente não é "gerar sorteio").
-- ---------------------------------------------------------------------
drop policy if exists "partidas_insert" on public.partidas;
drop policy if exists "partidas_delete" on public.partidas;

create policy "partidas_insert" on public.partidas
  for insert with check (public.get_my_role() in ('admin_master', 'presidente'));

create policy "partidas_delete" on public.partidas
  for delete using (public.get_my_role() in ('admin_master', 'presidente'));


-- ---------------------------------------------------------------------
-- 2. JOGADORES (elenco de cada equipe)
-- ---------------------------------------------------------------------
create table if not exists public.jogadores (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  nome text not null,
  numero int,
  posicao text,
  foto_url text,
  created_at timestamptz not null default now()
);

alter table public.jogadores enable row level security;

create policy "jogadores_select_public" on public.jogadores
  for select using (true);

create policy "jogadores_write" on public.jogadores
  for all
  using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'))
  with check (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));


-- ---------------------------------------------------------------------
-- 3. PATROCINADORES
-- ---------------------------------------------------------------------
create table if not exists public.patrocinadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text not null,
  link text,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.patrocinadores enable row level security;

create policy "patrocinadores_select_public" on public.patrocinadores
  for select using (true);

create policy "patrocinadores_write" on public.patrocinadores
  for all
  using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'))
  with check (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));


-- ---------------------------------------------------------------------
-- 4. STORAGE — buckets públicos para leitura, escrita só pra staff
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('escudos', 'escudos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('jogadores', 'jogadores', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('patrocinadores', 'patrocinadores', true)
on conflict (id) do nothing;

-- Leitura pública dos três buckets
create policy "storage_read_public" on storage.objects
  for select using (bucket_id in ('escudos', 'jogadores', 'patrocinadores'));

-- Upload/edição/exclusão: qualquer staff autenticado (a checagem de QUEM
-- pode criar a equipe em si continua na policy "equipes_insert")
create policy "storage_write_staff" on storage.objects
  for insert with check (
    bucket_id in ('escudos', 'jogadores', 'patrocinadores')
    and public.get_my_role() in ('admin_master', 'presidente', 'diretor')
  );

create policy "storage_update_staff" on storage.objects
  for update using (
    bucket_id in ('escudos', 'jogadores', 'patrocinadores')
    and public.get_my_role() in ('admin_master', 'presidente', 'diretor')
  );

create policy "storage_delete_staff" on storage.objects
  for delete using (
    bucket_id in ('escudos', 'jogadores', 'patrocinadores')
    and public.get_my_role() in ('admin_master', 'presidente', 'diretor')
  );
