import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTelegramAuthContext } from "@/components/TelegramAuthProvider";
import { hapticNotification } from "@/lib/haptics";
import {
  BackendApiError,
  createAdminAiRule,
  deleteAdminAiRule,
  fetchAdminAiRules,
} from "@/lib/backendApi";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof BackendApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function AIRulesManager() {
  const { profile } = useTelegramAuthContext();
  const adminTelegramId =
    profile?.telegram_id ||
    (typeof window !== "undefined"
      ? (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
      : null);
  const telegramId = adminTelegramId ? Number(adminTelegramId) : undefined;

  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("");

  const {
    data: rules = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin-ai-rules", telegramId ?? null],
    queryFn: () => fetchAdminAiRules(telegramId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createAdminAiRule(
        {
          keyword: keyword.trim(),
          correct_category: category.trim(),
        },
        telegramId
      ),
    onSuccess: async () => {
      hapticNotification("success");
      toast.success("Правило додано. Gemini врахує його при наступній категоризації.");
      setKeyword("");
      setCategory("");
      await refetch();
    },
    onError: (err) => {
      hapticNotification("error");
      toast.error(errorMessage(err, "Не вдалося додати правило"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: number) => deleteAdminAiRule(ruleId, telegramId),
    onSuccess: async () => {
      hapticNotification("success");
      toast.success("Правило видалено");
      await refetch();
    },
    onError: (err) => {
      hapticNotification("error");
      toast.error(errorMessage(err, "Не вдалося видалити правило"));
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const nextKeyword = keyword.trim();
    const nextCategory = category.trim();
    if (!nextKeyword || !nextCategory) {
      toast.error("Вкажіть ключове слово і категорію.");
      return;
    }
    createMutation.mutate();
  };

  const deletingId = deleteMutation.isPending ? deleteMutation.variables : null;
  const glass =
    "rounded-xl border border-white/10 bg-[#1c1c1e]/80 backdrop-blur-xl";

  return (
    <div className="space-y-3 text-zinc-100">
      <form onSubmit={handleSubmit} className={`${glass} p-3 space-y-3`}>
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold text-white">Нове правило</p>
            <p className="text-[11px] text-zinc-400 leading-tight">
              Якщо в тексті товару є слово — Gemini поставить вашу категорію
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-rule-keyword" className="text-[11px] text-zinc-400">
            Ключове слово (напр. худі, піксель)
          </Label>
          <Input
            id="ai-rule-keyword"
            value={keyword}
            maxLength={255}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="худі"
            className="h-9 bg-black/40 border-white/10 text-white placeholder:text-zinc-500"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-rule-category" className="text-[11px] text-zinc-400">
            Правильна категорія (напр. Кофти, Мілітарі)
          </Label>
          <Input
            id="ai-rule-category"
            value={category}
            maxLength={255}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Кофти"
            className="h-9 bg-black/40 border-white/10 text-white placeholder:text-zinc-500"
          />
        </div>

        <Button
          type="submit"
          disabled={createMutation.isPending}
          className="w-full h-9 bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Додати правило
        </Button>
      </form>

      <div className={`${glass} p-3 space-y-2`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">Існуючі правила</p>
          <span className="text-[11px] text-zinc-500">{rules.length}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <p className="text-xs text-red-400 py-4 text-center">
            {errorMessage(error, "Не вдалося завантажити правила")}
          </p>
        ) : rules.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4 text-center">
            Словник порожній. Додайте перше правило вище.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2"
              >
                <span className="min-w-0 flex-1 text-xs text-zinc-200 truncate">
                  <span className="font-medium text-white">{rule.keyword}</span>
                  {" "}➡️{" "}
                  <span className="text-emerald-300">{rule.correct_category}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(rule.id)}
                  aria-label={`Видалити правило ${rule.keyword}`}
                >
                  {deletingId === rule.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
