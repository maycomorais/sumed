const form = document.getElementById('login-form');
const errorBox = document.getElementById('error-box');
const btnSubmit = document.getElementById('btn-submit');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('show');
}

function clearError() {
  errorBox.classList.remove('show');
}

// Se já existe sessão válida com papel de staff, pula direto pro admin.
(async () => {
  const current = await getCurrentUser();
  if (current) window.location.href = 'admin.html';
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Entrando...';

  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });

  if (error) {
    showError('E-mail ou senha inválidos.');
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Entrar';
    return;
  }

  // Login no Auth funcionou, mas só é "staff" se existir linha em usuarios
  // com ativo = true. Isso impede que uma conta órfã (ex.: criada e depois
  // removida de usuarios) continue acessando o painel.
  const { data: profile, error: profileError } = await sb
    .from('usuarios')
    .select('role, ativo')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile || !profile.ativo) {
    await sb.auth.signOut();
    showError('Esta conta não tem acesso ao painel administrativo.');
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Entrar';
    return;
  }

  window.location.href = 'admin.html';
});
