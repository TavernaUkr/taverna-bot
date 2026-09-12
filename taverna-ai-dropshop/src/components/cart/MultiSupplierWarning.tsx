import { AlertTriangle, Package, Truck, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MultiSupplierWarningProps {
  supplierCount: number;
  hasFulfillmentOption?: boolean;
  onFulfillmentClick?: () => void;
}

export function MultiSupplierWarning({
  supplierCount,
  hasFulfillmentOption = true,
  onFulfillmentClick,
}: MultiSupplierWarningProps) {
  if (supplierCount <= 1) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">
            Товари від {supplierCount} різних постачальників
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Замовлення буде надіслано {supplierCount} окремими посилками. 
            Кожна посилка оплачується окремо при отриманні.
          </p>
        </div>
      </div>

      {/* Visual representation */}
      <div className="flex items-center justify-center gap-2 py-2">
        {Array.from({ length: supplierCount }).map((_, i) => (
          <div key={i} className="flex items-center">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
            {i < supplierCount - 1 && (
              <div className="w-4 h-0.5 bg-muted-foreground/30" />
            )}
          </div>
        ))}
        <div className="mx-2">
          <Truck className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <span className="text-lg">🏠</span>
        </div>
      </div>

      {/* Fulfillment option */}
      {hasFulfillmentOption && (
        <button
          type="button"
          onClick={onFulfillmentClick}
          className={cn(
            'w-full flex items-center gap-3 p-3 rounded-lg',
            'bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors'
          )}
        >
          <MapPin className="h-5 w-5 text-primary" />
          <div className="flex-1 text-left">
            <p className="font-medium text-sm text-foreground">
              Обрати Фулфілмент НП
            </p>
            <p className="text-xs text-muted-foreground">
              Товари зберуться на складі НП і приїдуть однією посилкою
            </p>
          </div>
        </button>
      )}
    </div>
  );
}
