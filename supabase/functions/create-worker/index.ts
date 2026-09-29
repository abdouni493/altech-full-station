// Supabase Edge Function: create-worker
// Deploy: supabase functions deploy create-worker
// Required secret: SUPABASE_SERVICE_ROLE_KEY (set via `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...`)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TABLE: Record<string, string> = {
  pompiste: "pompistes",
  chef_brigade: "brigade_chefs",
  gerant: "gerants",
  magasin: "magasin_workers",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { action, workerType, workerId, username, password, name } =
      await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const table = TABLE[workerType];
    if (!table) throw new Error(`Type de travailleur invalide: ${workerType}`);

    const email = `${String(username ?? "").toLowerCase()}@workers.station.local`;

    if (action === "create") {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, username, role: workerType },
      });
      if (error) throw error;
      const authUserId = data.user.id;

      const { error: upErr } = await admin
        .from(table)
        .update({ auth_user_id: authUserId, username })
        .eq("id", workerId);
      if (upErr) throw upErr;

      return new Response(
        JSON.stringify({ ok: true, auth_user_id: authUserId }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (action === "update_password") {
      const { data: row } = await admin
        .from(table)
        .select("auth_user_id")
        .eq("id", workerId)
        .maybeSingle();
      if (!row?.auth_user_id)
        throw new Error("Aucun compte auth pour ce travailleur");
      const { error } = await admin.auth.admin.updateUserById(
        row.auth_user_id,
        { password },
      );
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { data: row } = await admin
        .from(table)
        .select("auth_user_id")
        .eq("id", workerId)
        .maybeSingle();
      if (row?.auth_user_id) {
        await admin.auth.admin.deleteUser(row.auth_user_id);
        await admin.from(table).update({ auth_user_id: null }).eq("id", workerId);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Action inconnue: ${action}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
