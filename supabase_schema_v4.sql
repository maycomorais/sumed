-- =====================================================================
-- SUMED 2026 — Migração v4: Categorias (Masculino / Feminino)
-- Rode DEPOIS de v1, v2 e v3.
-- =====================================================================

alter table public.equipes
  add column if not exists categoria text not null default 'masculino'
  check (categoria in ('masculino', 'feminino'));

alter table public.partidas
  add column if not exists categoria text not null default 'masculino'
  check (categoria in ('masculino', 'feminino'));

create index if not exists idx_equipes_categoria on public.equipes(categoria);
create index if not exists idx_partidas_categoria on public.partidas(categoria);

-- As 13 equipes já cadastradas ficam explicitamente como 'masculino'
-- (o default acima já cobre isso, este update é só documentação/garantia
-- caso o default não tenha existido no momento do insert).
update public.equipes set categoria = 'masculino' where categoria is null;
update public.partidas set categoria = 'masculino' where categoria is null;
