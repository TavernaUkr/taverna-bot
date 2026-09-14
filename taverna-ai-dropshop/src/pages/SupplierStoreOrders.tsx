import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Package, MessageSquare, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { SupplierOrders } from "@/components/supplier/SupplierOrders";
import { ManagerShopChats } from "@/components/manager/ManagerShopChats";
import { hapticSelection } from "@/lib/haptics";

export default function SupplierStoreOrders() {
  const navigate = useNavigate();
  const { supplierId: paramSupplierId } = useParams<{ supplierId?: string }>();
  const { profile } = useTelegramAuth();
  const [searchParams] = useSearchParams();
  const [supplierId, setSupplierId] = useState<string | null>(paramSupplierId || null);
  const [isLoading, setIsLoading] = useState(!paramSupplierId);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "chat" ? "chat" : "orders");

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
          // Check if user has multiple shops
          const { data } = await supabase
            .from("suppliers")
            .select("id")
            .eq("telegram_id", profile.telegram_id);
          
          if (data && data.length > 1) {
            // Multiple shops - redirect to shop selector
            navigate("/my-shops", { replace: true });
            return;
          }
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

  // Use "demo" as fallback supplierId for mock data display
  const effectiveSupplierId = supplierId || "demo";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => { hapticSelection(); navigate("/my-shops"); }}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="font-bold text-lg text-foreground">Замовлення магазину</h1>
              <p className="text-xs text-muted-foreground">Керуйте замовленнями та спілкуйтесь з клієнтами</p>
            </div>
          </div>
          {/* AI Chat indicator */}
          <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-emerald-500" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2 h-11">
            <TabsTrigger value="orders" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Замовлення
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Чат з клієнтами
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-4">
            <SupplierOrders supplierId={effectiveSupplierId} />
          </TabsContent>

          <TabsContent value="chat" className="mt-4">
            <ManagerShopChats lockedSupplierId={effectiveSupplierId === "demo" ? undefined : effectiveSupplierId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
