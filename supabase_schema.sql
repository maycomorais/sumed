-- =====================================================================
-- SUMED 2026 — Schema de Autenticação e Autorização (Supabase)
-- =====================================================================
-- Rode este script inteiro no SQL Editor do seu projeto Supabase.
-- Pressupõe que auth.users já existe (é o schema padrão do Supabase Auth).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELA DE USUÁRIOS INTERNOS (staff: AdminMaster / Presidente / Diretor)
-- ---------------------------------------------------------------------
create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  role text not null check (role in ('admin_master', 'presidente', 'diretor')),
  ativo boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Função auxiliar (security definer) para ler o papel do usuário logado
-- sem cair em recursão de RLS quando outras policies consultam esta tabela.
create or replace function public.get_my_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.usuarios where id = auth.uid();
$$;

alter table public.usuarios enable row level security;

-- Cada usuário lê o próprio registro; AdminMaster lê todos.
create policy "usuarios_select" on public.usuarios
  for select using (
    id = auth.uid() or public.get_my_role() = 'admin_master'
  );

-- Só AdminMaster insere/atualiza/exclui usuários.
-- (Na prática, a criação real de contas de auth.users acontece via Edge
-- Function com service_role — veja edge-function-manage-users.ts — mas
-- mantemos a policy como segunda camada de defesa.)
create policy "usuarios_insert" on public.usuarios
  for insert with check (public.get_my_role() = 'admin_master');

create policy "usuarios_update" on public.usuarios
  for update using (public.get_my_role() = 'admin_master');

create policy "usuarios_delete" on public.usuarios
  for delete using (public.get_my_role() = 'admin_master');


-- ---------------------------------------------------------------------
-- 2. EQUIPES
-- ---------------------------------------------------------------------
create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  escudo_url text,
  presidente text default 'A definir',
  capitao text default 'A definir',
  comissao_tecnica text default 'A definir',
  created_at timestamptz not null default now()
);

alter table public.equipes enable row level security;

-- Leitura pública (o app público mostra tabela/equipes sem login).
create policy "equipes_select_public" on public.equipes
  for select using (true);

-- Criar e excluir: só AdminMaster e Presidente (Diretor NÃO pode).
create policy "equipes_insert" on public.equipes
  for insert with check (public.get_my_role() in ('admin_master', 'presidente'));

create policy "equipes_delete" on public.equipes
  for delete using (public.get_my_role() in ('admin_master', 'presidente'));

-- Editar dados da equipe: os três papéis podem.
create policy "equipes_update" on public.equipes
  for update using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));


-- ---------------------------------------------------------------------
-- 3. PARTIDAS
-- ---------------------------------------------------------------------
create table if not exists public.partidas (
  id text primary key, -- mantém compatibilidade com os ids tipo 'm_1_0'
  rodada int not null,
  equipe_a uuid references public.equipes(id),
  equipe_b uuid references public.equipes(id),
  placar_a int,
  placar_b int,
  data date,
  hora time,
  local text default 'Campo Principal',
  status text default 'SCHEDULED' check (status in ('SCHEDULED', 'FINISHED')),
  sumula_nota text default '',
  is_bye boolean default false,
  created_at timestamptz not null default now()
);

alter table public.partidas enable row level security;

create policy "partidas_select_public" on public.partidas
  for select using (true);

-- Sorteio, edição de calendário e lançamento de placar: os três papéis.
create policy "partidas_insert" on public.partidas
  for insert with check (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));

create policy "partidas_update" on public.partidas
  for update using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));

create policy "partidas_delete" on public.partidas
  for delete using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));


-- ---------------------------------------------------------------------
-- 4. CONFIGURAÇÕES (regulamento, rodada atual etc.)
-- ---------------------------------------------------------------------
create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

create policy "config_select_public" on public.configuracoes
  for select using (true);

create policy "config_upsert" on public.configuracoes
  for all using (public.get_my_role() in ('admin_master', 'presidente', 'diretor'))
  with check (public.get_my_role() in ('admin_master', 'presidente', 'diretor'));


-- ---------------------------------------------------------------------
-- 5. SEED — cria o primeiro AdminMaster manualmente
-- ---------------------------------------------------------------------
-- IMPORTANTE: rode isso só DEPOIS de criar o usuário no painel
-- Authentication > Users do Supabase (ou via signUp), pegue o UUID gerado
-- e substitua abaixo. Esse é o único usuário criado "na mão" — todos os
-- demais devem ser criados pelo AdminMaster através da Edge Function.
--
-- insert into public.usuarios (id, nome, email, role)
-- values ('COLE-O-UUID-AQUI', 'Seu Nome', 'seu@email.com', 'admin_master');
