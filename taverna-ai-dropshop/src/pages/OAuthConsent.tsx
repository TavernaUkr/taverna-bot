import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Typed wrapper for the beta supabase.auth.oauth namespace.
type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
const oauthNs = () => (supabase.auth as unknown as { oauth: OAuthNs }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauthNs().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauthNs().approveAuthorization(authorizationId)
      : await oauthNs().denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Сервер авторизації не повернув redirect.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md p-6">
          <h1 className="text-lg font-semibold mb-2">Не вдалося обробити запит</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </Card>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      </main>
    );
  }

  const clientName = details.client?.name ?? "зовнішній застосунок";
  const scopes: string[] = details.scopes ?? details.requested_scopes ?? [];

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="max-w-md w-full p-6 space-y-4">
        <h1 className="text-xl font-semibold">
          Підключити {clientName} до Taverna Group
        </h1>
        <p className="text-sm text-muted-foreground">
          {clientName} зможе використовувати доступні інструменти цього застосунку від вашого імені.
          Це не оминає політик безпеки та RLS вашого акаунта.
        </p>
        {scopes.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <div className="font-medium mb-1">Запитувані дозволи:</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {scopes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
            Дозволити
          </Button>
          <Button onClick={() => decide(false)} disabled={busy} variant="outline" className="flex-1">
            Відхилити
          </Button>
        </div>
      </Card>
    </main>
  );
}
