import { useNavigate } from "react-router-dom";
import { Trophy, Info } from "lucide-react";
import { RatingsTab } from "@/components/RatingsTab";
import { ScreenBackButton } from "@/components/navigation/ScreenBackButton";
import { RatingRulesSheet } from "@/components/ratings/RatingRulesSheet";
import { useState } from "react";

export default function Ratings() {
  const navigate = useNavigate();
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background w-full max-w-[100vw] overflow-x-clip pb-8">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center gap-2 p-4 max-w-md mx-auto w-full min-w-0">
          <ScreenBackButton onClick={() => navigate("/")} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-rating shrink-0" />
              <h1 className="font-bold text-lg text-foreground truncate">Рейтинги</h1>
            </div>
            <p className="text-xs text-muted-foreground">Лідери Taverna Group</p>
          </div>
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-muted text-foreground text-xs font-medium"
          >
            <Info className="h-3.5 w-3.5" />
            Правила
          </button>
        </div>
      </div>

      <main className="px-3 py-4 max-w-md mx-auto w-full min-w-0">
        <RatingsTab hideChrome />
      </main>

      <RatingRulesSheet open={rulesOpen} onOpenChange={setRulesOpen} />
    </div>
  );
}
