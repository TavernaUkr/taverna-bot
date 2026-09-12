import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Archive, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { SupplierOrders } from "@/components/supplier/SupplierOrders";
import { hapticSelection } from "@/lib/haptics";

export default function SupplierStoreOrdersHistory() {
  const navigate = useNavigate();
  const { supplierId: paramSupplierId } = useParams<{ supplierId?: string }>();
  const { profile } = useTelegramAuth();
  const [supplierId, setSupplierId] = useState<string | null>(paramSupplierId || null);
  const [isLoading, setIsLoading] = useState(!paramSupplierId);

  useEffect(() => {
    if (paramSupplierId) {
      setSupplierId(paramSupplierId);
      setIsLoading(false);
      return;
    }
    const findSupplier = async () => {
      setIsLoading(true);
      try {
        if (profile?.telegram_id) {
          const { data } = await supabase
            .from("suppliers")
            .select("id")
            .eq("telegram_id", profile.telegram_id)
            .limit(1);
          setSupplierId(data?.[0]?.id || null);
        }
      } catch (err) {
        console.error("Error finding supplier:", err);
      } finally {
        setIsLoading(false);
      }
    };
    findSupplier();
  }, [profile?.telegram_id, paramSupplierId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const effectiveSupplierId = supplierId || "demo";

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { hapticSelection(); navigate(-1); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-bold text-lg text-foreground">Історія замовлень магазину</h1>
          </div>
        </div>
      </div>
      <div className="p-4">
        <SupplierOrders supplierId={effectiveSupplierId} mode="history" />
      </div>
    </div>
  );
}
