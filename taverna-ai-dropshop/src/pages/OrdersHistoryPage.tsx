import { useNavigate } from "react-router-dom";
import { ArrowLeft, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrdersHistory } from "@/components/OrdersHistory";
import { hapticSelection } from "@/lib/haptics";

export default function OrdersHistoryPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { hapticSelection(); navigate("/?tab=account"); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-bold text-lg text-foreground">Історія замовлень</h1>
          </div>
        </div>
      </div>
      <div className="p-4">
        <OrdersHistory mode="history" />
      </div>
    </div>
  );
}
