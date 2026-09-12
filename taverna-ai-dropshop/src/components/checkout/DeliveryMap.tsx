import { MapPin, Navigation, Search, Clock, Star, Truck, Building2, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Branch {
  id: string;
  name: string;
  address: string;
  service: string;
  city: string;
  distance: string;
  hours: string;
  rating: number;
  type: "warehouse" | "postomat";
}

interface DeliveryMapProps {
  onSelectBranch?: (branch: {
    id: string;
    name: string;
    address: string;
    service: string;
  }) => void;
}

export function DeliveryMap({ onSelectBranch }: DeliveryMapProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  // Enhanced mock branches with more details
  const branches: Branch[] = [
    { id: "1", name: "Відділення №1", address: "вул. Хрещатик, 22", service: "nova_poshta", city: "Київ", distance: "0.3 км", hours: "9:00 - 20:00", rating: 4.8, type: "warehouse" },
    { id: "2", name: "Відділення №5", address: "вул. Шевченка, 15", service: "nova_poshta", city: "Київ", distance: "0.7 км", hours: "8:00 - 21:00", rating: 4.5, type: "warehouse" },
    { id: "3", name: "Поштомат №123", address: "вул. Лесі Українки, 7", service: "nova_poshta", city: "Київ", distance: "1.2 км", hours: "24/7", rating: 4.9, type: "postomat" },
    { id: "4", name: "Відділення №12", address: "пр. Перемоги, 45", service: "ukrposhta", city: "Київ", distance: "0.5 км", hours: "9:00 - 18:00", rating: 4.2, type: "warehouse" },
    { id: "5", name: "Meest Express №3", address: "вул. Володимирська, 33", service: "meest", city: "Київ", distance: "0.9 км", hours: "9:00 - 19:00", rating: 4.6, type: "warehouse" },
    { id: "6", name: "Поштомат М-15", address: "ТЦ Глобус, -1 поверх", service: "meest", city: "Київ", distance: "1.5 км", hours: "24/7", rating: 4.7, type: "postomat" },
  ];

  const filteredBranches = branches.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesService = !selectedService || b.service === selectedService;
    return matchesSearch && matchesService;
  });

  const services = [
    { id: 'nova_poshta', name: 'Нова Пошта', color: 'bg-red-500', abbr: 'НП' },
    { id: 'ukrposhta', name: 'Укрпошта', color: 'bg-amber-500', abbr: 'УП' },
    { id: 'meest', name: 'Meest', color: 'bg-blue-500', abbr: 'M' },
  ];

  const getServiceColor = (service: string) => {
    switch (service) {
      case 'nova_poshta': return 'bg-red-500';
      case 'ukrposhta': return 'bg-amber-500';
      case 'meest': return 'bg-blue-500';
      default: return 'bg-primary';
    }
  };

  const handleSelectBranch = (branch: Branch) => {
    setSelectedBranchId(branch.id);
    onSelectBranch?.(branch);
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Пошук відділення..."
          className="pl-10"
        />
      </div>

      {/* Service Filter Tabs */}
      <div className="flex gap-2">
        <Button
          variant={selectedService === null ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedService(null)}
          className="active:scale-95 transition-transform"
        >
          Всі
        </Button>
        {services.map((service) => (
          <Button
            key={service.id}
            variant={selectedService === service.id ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedService(selectedService === service.id ? null : service.id)}
            className="active:scale-95 transition-transform"
          >
            <span className={cn("w-2 h-2 rounded-full mr-1", service.color)} />
            {service.abbr}
          </Button>
        ))}
      </div>

      {/* Visual Map with Pins */}
      <div className="relative h-48 rounded-2xl overflow-hidden border border-border bg-gradient-to-br from-muted/30 to-muted/60">
        {/* Map Background Pattern */}
        <div className="absolute inset-0 opacity-30">
          <svg width="100%" height="100%" className="text-muted-foreground/20">
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Ukraine Silhouette Outline */}
        <div className="absolute inset-0 flex items-center justify-center opacity-10">
          <Navigation className="h-32 w-32 text-foreground" />
        </div>

        {/* Map Pins */}
        <AnimatePresence>
          {filteredBranches.slice(0, 6).map((branch, index) => {
            const positions = [
              { top: '25%', left: '30%' },
              { top: '35%', left: '55%' },
              { top: '45%', left: '40%' },
              { top: '30%', left: '70%' },
              { top: '55%', left: '25%' },
              { top: '50%', left: '60%' },
            ];
            const pos = positions[index % positions.length];
            
            return (
              <motion.button
                key={branch.id}
                initial={{ scale: 0, y: -20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0, y: -20 }}
                transition={{ delay: index * 0.05, type: "spring", stiffness: 300 }}
                onClick={() => handleSelectBranch(branch)}
                className={cn(
                  "absolute group cursor-pointer",
                  selectedBranchId === branch.id && "z-10"
                )}
                style={{ top: pos.top, left: pos.left }}
              >
                <div className={cn(
                  "relative transition-transform group-hover:scale-110",
                  selectedBranchId === branch.id && "scale-125"
                )}>
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white",
                    getServiceColor(branch.service),
                    selectedBranchId === branch.id && "ring-2 ring-primary ring-offset-2"
                  )}>
                    {branch.type === "postomat" ? (
                      <Package className="h-4 w-4 text-white" />
                    ) : (
                      <Building2 className="h-4 w-4 text-white" />
                    )}
                  </div>
                  {/* Pulse effect */}
                  <div className={cn(
                    "absolute inset-0 rounded-full animate-ping opacity-30",
                    getServiceColor(branch.service)
                  )} />
                </div>
                {/* Tooltip on hover */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-border">
                  {branch.name}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>

        {/* "Your location" marker */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="w-4 h-4 rounded-full bg-primary border-2 border-white shadow-lg animate-pulse" />
        </div>
      </div>

      {/* Branch List - Scrollable Cards */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Найближчі відділення</p>
          <span className="text-xs text-muted-foreground">{filteredBranches.length} знайдено</span>
        </div>
        
        <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent pr-1">
          {filteredBranches.map((branch) => (
            <motion.button
              key={branch.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => handleSelectBranch(branch)}
              className={cn(
                "w-full flex items-start gap-3 p-3 rounded-xl transition-all text-left",
                "bg-card/80 backdrop-blur-sm border hover:shadow-md active:scale-[0.98]",
                selectedBranchId === branch.id
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-border hover:border-primary/50"
              )}
            >
              {/* Service Icon */}
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                getServiceColor(branch.service)
              )}>
                {branch.type === "postomat" ? (
                  <Package className="h-5 w-5 text-white" />
                ) : (
                  <Truck className="h-5 w-5 text-white" />
                )}
              </div>

              {/* Branch Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-medium text-foreground text-sm truncate">{branch.name}</p>
                  {branch.type === "postomat" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      24/7
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{branch.address}</p>
                
                {/* Meta info */}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {branch.distance}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {branch.hours}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <Star className="h-3 w-3 fill-current" />
                    {branch.rating}
                  </span>
                </div>
              </div>

              {/* Selection indicator */}
              {selectedBranchId === branch.id && (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <svg className="w-3.5 h-3.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Service Legend */}
      <div className="flex items-center justify-center gap-4 pt-2 border-t border-border">
        {services.map((service) => (
          <div key={service.id} className="text-center">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-1",
              service.color + "/20"
            )}>
              <span className={cn("font-bold text-xs", service.color.replace('bg-', 'text-'))}>
                {service.abbr}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{service.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
