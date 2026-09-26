import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Package, MessageSquare, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { hapticSelection } from "@/lib/haptics";
import { StoreOrdersList } from "@/components/supplier/StoreOrdersList";
import SupportPanel from "@/pages/SupportPanel";

/**
 * «Замовлення магазину» (Orders Hub) — B2B панель керування продажами:
 * вкладка «Замовлення» (Kanban-подібний список з бекенду) + вкладка
 * «Чат з клієнтами» (SupportPanel із фільтром за цим магазином).
 *
 * Маршрут: /supplier/:id/orders (кнопка «Замовлення / Комунікація»
 * на картці магазину у MyShops).
 *
 * support/shop: паро́л signer — після успішного входу через Telegram
 * ми розуміємо роль юзера; для гостьових сесій — пустий стан.
 */
export default function StoreOrdersHub() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useTelegramAuthContext();
  const [activeTab, setActiveTab] = useState<"orders" | "chat">("orders");

  const supplierId = Number(id);
  const isValidSupplierId = Number.isInteger(supplierId) && supplierId > 0;

  // Невалідний :id → порожній стан (замість crash)
  if (!isValidSupplierId) {
    return (
      <div className="min-h-screen bg-background">
        <HubHeader />
        <EmptyState
          type="default"
          title="Магазин не знайдено"
          description="Некоректний ідентифікатор магазину у посиланні"
          action={{ label: "До моїх магазинів", onClick: () => navigate("/my-shops") }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <HubHeader />

      {!isAuthenticated ? (
        <EmptyState
          type="default"
          title="Потрібна авторизація"
          description="Увійдіть через Telegram, щоб керувати замовленнями магазину"
        />
      ) : (
        <div className="p-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "orders" | "chat")}>
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
              <StoreOrdersList supplierId={supplierId} />
            </TabsContent>

            <TabsContent value="chat" className="mt-4">
              {/* SupportPanel з фільтром за магазином: тікети саме цього магазину */}
              <SupportPanel supplierId={supplierId} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

/** Шапка хабу: назад → /my-shops, заголовок + підзаголовок. */
function HubHeader() {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            hapticSelection();
            navigate("/my-shops");
          }}
          aria-label="Назад до магазинів"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="font-bold text-lg text-foreground">Замовлення магазину</h1>
          <p className="text-xs text-muted-foreground">
            Керуйте замовленнями та спілкуйтесь з клієнтами
          </p>
        </div>
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ml-auto">
          <Store className="h-5 w-5 text-primary" />
        </div>
      </div>
    </div>
  );
}
