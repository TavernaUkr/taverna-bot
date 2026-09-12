import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin, Building2, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Warehouse {
  Ref: string;
  Description: string;
  Number: string;
  TypeOfWarehouse: string;
  CityDescription: string;
}

interface WarehouseSelectProps {
  cityRef: string;
  value: string;
  warehouseNumber: string;
  onSelect: (warehouse: Warehouse) => void;
  label?: string;
  required?: boolean;
  error?: string;
  type?: "branch" | "postomat" | "all";
  disabled?: boolean;
}

export const WarehouseSelect = ({
  cityRef,
  value,
  warehouseNumber,
  onSelect,
  label = "Відділення",
  required = true,
  error,
  type = "all",
  disabled = false,
}: WarehouseSelectProps) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!cityRef) {
      setWarehouses([]);
      return;
    }

    const loadWarehouses = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("nova-poshta", {
          body: { action: "getWarehouses", params: { cityRef } },
        });

        if (!error && data?.data) {
          let filtered = data.data;
          if (type === "branch") {
            filtered = data.data.filter((w: Warehouse) => w.TypeOfWarehouse === "Branch");
          } else if (type === "postomat") {
            filtered = data.data.filter((w: Warehouse) => w.TypeOfWarehouse === "Postomat");
          }
          setWarehouses(filtered);
        }
      } catch (err) {
        console.error("Warehouses load error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadWarehouses();
  }, [cityRef, type]);

  const getIcon = (warehouseType: string) => {
    return warehouseType === "Postomat" ? Box : Building2;
  };

  const selectedWarehouse = warehouses.find((w) => w.Ref === value);
  const hasSavedValue = value && warehouseNumber && !isLoading && !selectedWarehouse;

  if (!cityRef) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
          Спочатку оберіть місто
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      
      {isLoading ? (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Завантаження відділень...</span>
        </div>
      ) : (
        <Select
          value={value}
          onValueChange={(val) => {
            const warehouse = warehouses.find((w) => w.Ref === val);
            if (warehouse) onSelect(warehouse);
          }}
        >
          <SelectTrigger className={cn(error ? "border-destructive" : "")}>
            <SelectValue placeholder="Оберіть відділення">
              {selectedWarehouse ? (
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = getIcon(selectedWarehouse.TypeOfWarehouse);
                    return <Icon className="h-4 w-4 text-primary" />;
                  })()}
                  <span className="truncate">№{selectedWarehouse.Number}</span>
                </div>
              ) : hasSavedValue ? (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="truncate">Відділення №{warehouseNumber}</span>
                </div>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {warehouses.map((warehouse) => {
              const Icon = getIcon(warehouse.TypeOfWarehouse);
              return (
                <SelectItem key={warehouse.Ref} value={warehouse.Ref}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{warehouse.Description}</p>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
      
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};
