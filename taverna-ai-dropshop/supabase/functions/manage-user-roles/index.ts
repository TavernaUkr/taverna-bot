import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hashToken(token: string): Promise<string> {
  const secret = Deno.env.get("SESSION_HMAC_SECRET") || "";
  const encoder = new TextEncoder();
  if (secret) {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateSession(supabase: any, sessionToken: string) {
  const tokenHash = await hashToken(sessionToken);
  const { data: session, error } = await supabase
    .from("sessions")
    .select("*, profile:profiles(*)")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .single();
  if (error || !session) return null;
  return session;
}

async function isAdmin(supabase: any, profileId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", profileId);
  return (data || []).some((r: any) => r.role === "admin");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action, session_token, user_id, role } = body;

    if (!session_token) {
      return new Response(JSON.stringify({ error: "session_token required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await validateSession(supabase, session_token);
    if (!session) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerIsAdmin = await isAdmin(supabase, session.profile.id);

    // ---------------- get_my_roles (any authenticated user) ----------------
    if (action === "get_my_roles") {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.profile.id);
      return new Response(JSON.stringify({ roles: (data || []).map((r: any) => r.role) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- list_users_with_roles (admin only) ----------------
    if (action === "list_users_with_roles") {
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, telegram_username, telegram_id, avatar_url, is_active, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const { data: bans } = await supabase
        .from("user_bans")
        .select("profile_id, reason, banned_at, expires_at, is_active")
        .eq("is_active", true);

      const rolesByUser: Record<string, string[]> = {};
      (roles || []).forEach((r: any) => {
        rolesByUser[r.user_id] = rolesByUser[r.user_id] || [];
        rolesByUser[r.user_id].push(r.role);
      });
      const banByUser: Record<string, any> = {};
      (bans || []).forEach((b: any) => {
        banByUser[b.profile_id] = b;
      });

      const users = (profiles || []).map((p: any) => ({
        ...p,
        roles: rolesByUser[p.id] || ["customer"],
        activeBan: banByUser[p.id] || null,
      }));
      return new Response(JSON.stringify({ users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- add_role / remove_role (admin only) ----------------
    if (action === "add_role" || action === "remove_role") {
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: admin required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!user_id || !role) {
        return new Response(JSON.stringify({ error: "user_id and role required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const allowedRoles = ["admin", "moderator", "supplier", "shop_manager", "customer"];
      if (!allowedRoles.includes(role)) {
        return new Response(JSON.stringify({ error: "Invalid role" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "add_role") {
        const { error } = await supabase.from("user_roles").insert({ user_id, role });
        if (error && error.code !== "23505") {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        if (role === "customer") {
          return new Response(JSON.stringify({ error: "Cannot remove customer role" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", user_id)
          .eq("role", role);
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------------- ban_user / unban_user (admin only) ----------------
    if (action === "ban_user" || action === "unban_user") {
      if (!callerIsAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden: admin required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "ban_user") {
        const { reason, expires_at } = body;
        if (!reason) {
          return new Response(JSON.stringify({ error: "reason required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        await supabase.from("user_bans").insert({
          profile_id: user_id,
          reason: String(reason).slice(0, 500),
          expires_at,
          banned_by: session.profile.id,
        });
        await supabase.from("profiles").update({ is_active: false }).eq("id", user_id);
      } else {
        await supabase.from("user_bans").update({ is_active: false }).eq("profile_id", user_id).eq("is_active", true);
        await supabase.from("profiles").update({ is_active: true }).eq("id", user_id);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("manage-user-roles error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
