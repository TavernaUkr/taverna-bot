import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Package, Send, Megaphone, Globe2, Clock, Wallet } from "lucide-react";

interface Product {
  id: string;
  name: string;
  price: number;
  images: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: "posting" | "advertising";
  selectedProducts: Product[];
  useAllProducts: boolean;
  allProductsCount: number | null;
  shopNames: string[];
  platforms: string[];
  aiText: string;
  onAiTextChange: (v: string) => void;
  estimatedCost?: number;
  intervalSeconds?: number; // gap between posts (default ~90s)
  onConfirm: () => void;
  isSubmitting: boolean;
  paid?: boolean;
}

export function PromotionPreviewDialog({
  open,
  onOpenChange,
  type,
  selectedProducts,
  useAllProducts,
  allProductsCount,
  shopNames,
  platforms,
  aiText,
  onAiTextChange,
  estimatedCost,
  intervalSeconds = 90,
  onConfirm,
  isSubmitting,
  paid,
}: Props) {
  const productCount = useAllProducts ? allProductsCount ?? 0 : selectedProducts.length;
  const showFirst = selectedProducts.slice(0, 5);
  const restCount = Math.max(0, selectedProducts.length - 5);
  const totalSeconds = productCount * intervalSeconds;
  const minutesEstimate = Math.max(1, Math.round(totalSeconds / 60));
  const hasTemplate = /\{name\}|\{price\}/i.test(aiText);

  const Icon = type === "posting" ? Send : Megaphone;
  const title = type === "posting" ? "Підтвердіть постинг" : "Підтвердіть рекламу";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Перевірте параметри кампанії перед запуском.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-2">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-muted/50 rounded-lg p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Globe2 className="h-3 w-3" /> Магазинів
                </p>
                <p className="font-semibold text-sm mt-0.5">{shopNames.length || "усі"}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Package className="h-3 w-3" /> Товарів
                </p>
                <p className="font-semibold text-sm mt-0.5">
                  {useAllProducts ? `усі (${allProductsCount ?? "..."})` : productCount}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5">
                <p className="text-muted-foreground">Платформи</p>
                <p className="font-semibold text-sm mt-0.5">{platforms.length}</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2.5">
                <p className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Орієнтовно
                </p>
                <p className="font-semibold text-sm mt-0.5">~{minutesEstimate} хв</p>
              </div>
            </div>

            {/* Cost */}
            {estimatedCost !== undefined && estimatedCost > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/30">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Орієнтовна вартість</span>
                </div>
                <span className="text-lg font-bold text-primary">{estimatedCost} ₴</span>
              </div>
            )}

            {/* Products preview */}
            {!useAllProducts && selectedProducts.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Товари ({selectedProducts.length})</Label>
                <div className="mt-1 space-y-1">
                  {showFirst.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                      <div className="w-9 h-9 bg-muted rounded overflow-hidden shrink-0">
                        {p.images?.[0] && <img src={p.images[0]} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{p.name}</p>
                        <p className="text-xs text-primary">{p.price} ₴</p>
                      </div>
                    </div>
                  ))}
                  {restCount > 0 && (
                    <p className="text-xs text-muted-foreground text-center py-1">
                      …і ще {restCount} товар(ів)
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Shops */}
            {shopNames.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">Магазини</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {shopNames.slice(0, 6).map((n) => (
                    <Badge key={n} variant="secondary" className="text-xs">
                      {n}
                    </Badge>
                  ))}
                  {shopNames.length > 6 && (
                    <Badge variant="outline" className="text-xs">
                      +{shopNames.length - 6}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Platforms */}
            <div>
              <Label className="text-xs text-muted-foreground">Платформи</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {platforms.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Editable text */}
            <div>
              <Label className="text-xs text-muted-foreground flex items-center justify-between">
                <span>Текст {hasTemplate && "(шаблон)"}</span>
                {hasTemplate && (
                  <span className="text-[10px] text-muted-foreground">
                    {"{name}"}, {"{price}"} підставляться автоматично
                  </span>
                )}
              </Label>
              <Textarea
                value={aiText}
                onChange={(e) => onAiTextChange(e.target.value)}
                rows={6}
                className="mt-1 text-xs font-mono"
                placeholder="Текст для публікації…"
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Скасувати
          </Button>
          <Button onClick={onConfirm} disabled={isSubmitting || !aiText.trim()}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Запуск...
              </>
            ) : paid ? (
              <>Оплатити та запустити</>
            ) : (
              <>Запустити кампанію</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
