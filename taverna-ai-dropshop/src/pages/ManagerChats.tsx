import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManagerShopChats } from "@/components/manager/ManagerShopChats";
import { BottomNavigation } from "@/components/BottomNavigation";
import { hapticSelection } from "@/lib/haptics";

export default function ManagerChats() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 max-w-md mx-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              hapticSelection();
              navigate(-1);
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-bold text-lg text-foreground">Чати магазинів</h1>
            <p className="text-xs text-muted-foreground">Усі звернення клієнтів. Фільтр — по магазину.</p>
          </div>
        </div>
      </div>

      <div className="p-4 pb-24 max-w-md mx-auto">
        <ManagerShopChats />
      </div>

      <BottomNavigation
        activeTab="account"
        onTabChange={(tab) => {
          if (tab === "catalog") navigate("/");
          else if (tab === "suppliers") navigate("/suppliers");
          else if (tab === "support") navigate("/support");
          else if (tab === "cart") navigate("/cart");
          else if (tab === "account") navigate("/?tab=account");
          else if (tab === "live") navigate("/?tab=live");
          else navigate("/");
        }}
      />
    </div>
  );
}
