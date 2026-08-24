// =====================================================================
// Supabase Edge Function: manage-users
// =====================================================================
// Deploy: supabase functions deploy manage-users
// Chamada pelo frontend (admin.js) SOMENTE por sessões cujo papel já
// seja 'admin_master' — a validação abaixo é a garantia real disso,
// porque é a única peça de código com acesso à service_role key.
//
// Body esperado (JSON):
//   { action: 'create', email, senha, nome, role }
//   { action: 'delete', userId }
//   { action: 'list' }
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace("Bearer ", "");

    // Cliente com o token de quem chamou, só para identificar o usuário.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(callerToken);
    if (callerError || !callerData?.user) {
      return json({ error: "Não autenticado." }, 401);
    }

    // Cliente admin (service role) para consultas privilegiadas.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile } = await adminClient
      .from("usuarios")
      .select("role")
      .eq("id", callerData.user.id)
      .single();

    if (callerProfile?.role !== "admin_master") {
      return json({ error: "Apenas AdminMaster pode gerenciar usuários." }, 403);
    }

    const body = await req.json();

    if (body.action === "list") {
      const { data, error } = await adminClient
        .from("usuarios")
        .select("id, nome, email, role, ativo, created_at")
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ usuarios: data });
    }

    if (body.action === "create") {
      const { email, senha, nome, role } = body;
      if (!["presidente", "diretor", "admin_master"].includes(role)) {
        return json({ error: "Papel inválido." }, 400);
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
      });
      if (createError) return json({ error: createError.message }, 400);

      const { error: insertError } = await adminClient.from("usuarios").insert({
        id: created.user.id,
        nome,
        email,
        role,
        created_by: callerData.user.id,
      });
      if (insertError) {
        // rollback do usuário de auth se a inserção do perfil falhar
        await adminClient.auth.admin.deleteUser(created.user.id);
        return json({ error: insertError.message }, 400);
      }

      return json({ success: true, userId: created.user.id });
    }

    if (body.action === "delete") {
      const { userId } = body;
      if (userId === callerData.user.id) {
        return json({ error: "Você não pode excluir a si mesmo." }, 400);
      }
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
