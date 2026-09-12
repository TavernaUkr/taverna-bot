import { Truck, Clock, MapPin, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeliveryEstimateProps {
  service: "nova_poshta" | "ukrposhta" | "rozetka" | "meest" | "justin";
  type: "branch" | "postomat" | "courier" | "fulfillment";
  city?: string;
}

const serviceData: Record<string, { name: string; color: string; logo: string }> = {
  nova_poshta: { name: "Нова Пошта", color: "text-red-500", logo: "🔴" },
  ukrposhta: { name: "Укрпошта", color: "text-yellow-600", logo: "📮" },
  rozetka: { name: "Rozetka", color: "text-green-500", logo: "🟢" },
  meest: { name: "Meest", color: "text-blue-500", logo: "🔵" },
  justin: { name: "Justin", color: "text-purple-500", logo: "🟣" },
};

const getEstimates = (service: string, type: string, city?: string) => {
  const isKyiv = city?.toLowerCase().includes("київ");
  const isLargeCity = ["харків", "одеса", "дніпро", "львів", "запоріжжя"].some(
    (c) => city?.toLowerCase().includes(c)
  );

  let days = { min: 1, max: 3 };
  let cost = { min: 50, max: 100 };

  switch (service) {
    case "nova_poshta":
      if (isKyiv) {
        days = type === "courier" ? { min: 0, max: 1 } : { min: 1, max: 2 };
      } else if (isLargeCity) {
        days = { min: 1, max: 2 };
      } else {
        days = { min: 2, max: 4 };
      }
      cost = type === "courier" ? { min: 80, max: 150 } : { min: 45, max: 80 };
      if (type === "fulfillment") {
        cost = { min: 35, max: 60 };
      }
      break;
    case "ukrposhta":
      days = isKyiv ? { min: 2, max: 3 } : { min: 3, max: 7 };
      cost = { min: 25, max: 50 };
      break;
    case "rozetka":
      days = isKyiv ? { min: 1, max: 2 } : { min: 2, max: 4 };
      cost = { min: 40, max: 70 };
      break;
    case "meest":
      days = isKyiv ? { min: 1, max: 2 } : { min: 2, max: 5 };
      cost = { min: 35, max: 65 };
      break;
    case "justin":
      days = isKyiv ? { min: 1, max: 2 } : { min: 2, max: 4 };
      cost = { min: 35, max: 60 };
      break;
  }

  return { days, cost };
};

export const DeliveryEstimate = ({ service, type, city }: DeliveryEstimateProps) => {
  const { days, cost } = getEstimates(service, type, city);
  const serviceInfo = serviceData[service];

  if (!serviceInfo) return null;

  return (
    <div className="bg-muted/50 rounded-xl p-4 space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <span className="text-lg">{serviceInfo.logo}</span>
        <span className={cn("font-semibold text-sm", serviceInfo.color)}>
          {serviceInfo.name}
        </span>
        {type === "fulfillment" && (
          <span className="ml-auto px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
            Фулфілмент
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Доставка</p>
            <p className="font-medium">
              {days.min === days.max
                ? `${days.min} ${days.min === 1 ? "день" : "дні"}`
                : `${days.min}-${days.max} дні`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center">
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Вартість</p>
            <p className="font-medium">
              {cost.min === cost.max ? `${cost.min}₴` : `${cost.min}-${cost.max}₴`}
            </p>
          </div>
        </div>
      </div>

      {type === "fulfillment" && (
        <div className="flex items-start gap-2 p-3 bg-success/10 rounded-lg">
          <Truck className="h-4 w-4 text-success mt-0.5" />
          <div className="text-xs">
            <p className="font-medium text-success">Фулфілмент НП</p>
            <p className="text-muted-foreground">
              Товари об'єднуються в одну посилку на складі Нової Пошти
            </p>
          </div>
        </div>
      )}

      {city && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          <span>Розрахунок для: {city}</span>
        </div>
      )}
    </div>
  );
};
