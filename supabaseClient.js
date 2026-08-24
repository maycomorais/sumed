// =====================================================================
// Cliente Supabase compartilhado — SUMED 2026
// =====================================================================
// Preencha com as credenciais do seu projeto (Settings > API no Supabase).
// A anon key é pública por design (a segurança real está nas RLS policies
// do supabase_schema.sql, não em esconder essa chave).
// =====================================================================

const SUPABASE_URL = 'https://mygseytzykxdlnkixzbi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15Z3NleXR6eWt4ZGxua2l4emJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDIyNDMsImV4cCI6MjEwMzA3ODI0M30.JX_QSVYoOeCgbBGZeWo4vR6ekS_gs_7jUDtpkTIWhI0';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ROLES = {
  ADMIN_MASTER: 'admin_master',
  PRESIDENTE: 'presidente',
  DIRETOR: 'diretor',
};

// Retorna { session, profile } ou null se não houver sessão válida.
async function getCurrentUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  const { data: profile, error } = await sb
    .from('usuarios')
    .select('id, nome, email, role, ativo')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || !profile.ativo) return null;
  return { session, profile };
}

// Guard para páginas administrativas. Redireciona pro login se não houver
// sessão, ou pro index público se o papel não estiver na allowlist.
// Isto é conveniência de UX — a garantia real de segurança são as RLS
// policies no banco, que valem mesmo que alguém pule esse guard no console.
async function requireRole(allowedRoles) {
  const current = await getCurrentUser();
  if (!current) {
    window.location.href = 'login.html';
    return null;
  }
  if (!allowedRoles.includes(current.profile.role)) {
    alert('Você não tem permissão para acessar esta área.');
    window.location.href = 'index.html';
    return null;
  }
  return current;
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}
