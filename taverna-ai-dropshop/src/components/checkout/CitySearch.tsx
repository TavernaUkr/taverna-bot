import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface City {
  Ref: string;
  Description: string;
  Present: string;
  Warehouses?: number;
}

interface CitySearchProps {
  value: string;
  cityRef: string;
  onSelect: (city: City) => void;
  label?: string;
  required?: boolean;
  error?: string;
}

// Parse the Nova Poshta API response into a flat City array
function parseCityResponse(data: any): City[] {
  if (!data?.data) return [];

  const raw = data.data;

  // If it's already a flat array of cities
  if (Array.isArray(raw) && raw.length > 0 && raw[0]?.MainDescription) {
    return raw.map((c: any) => ({
      Ref: c.Ref ?? '',
      Description: c.MainDescription ?? c.Description ?? '',
      Present: c.Present ?? '',
      Warehouses: c.Warehouses ?? 0,
    }));
  }

  // Nova Poshta wraps in [{Addresses: [...]}]
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]?.Addresses)) {
    return raw[0].Addresses.map((c: any) => ({
      Ref: c.Ref ?? '',
      Description: c.MainDescription ?? c.Description ?? '',
      Present: c.Present ?? '',
      Warehouses: c.Warehouses ?? 0,
    }));
  }

  return [];
}

export const CitySearch = ({
  value,
  cityRef,
  onSelect,
  label = "Місто",
  required = true,
  error,
}: CitySearchProps) => {
  const [search, setSearch] = useState(value || '');
  const [cities, setCities] = useState<City[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => {
    if (value && value !== search) {
      setSearch(value);
    }
  }, [value]);

  // Search cities
  useEffect(() => {
    const searchStr = search ?? '';
    const valueStr = value ?? '';
    if (searchStr.length < 2 || searchStr === valueStr) {
      setCities([]);
      return;
    }

    const searchCities = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("nova-poshta", {
          body: { action: "searchCity", params: { query: searchStr } },
        });

        if (!error && data) {
          const parsed = parseCityResponse(data);
          setCities(parsed);
          if (parsed.length > 0) setIsOpen(true);
        }
      } catch (err) {
        console.error("City search error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    const debounce = setTimeout(searchCities, 300);
    return () => clearTimeout(debounce);
  }, [search, value]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (city: City) => {
    setSearch(city.Description);
    setCities([]);
    setIsOpen(false);
    onSelect(city);
  };

  return (
    <div className="space-y-2" ref={containerRef}>
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </div>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (e.target.value !== (value ?? '')) {
              setIsOpen(true);
            }
          }}
          onFocus={() => {
            if (cities.length > 0) setIsOpen(true);
          }}
          placeholder="Почніть вводити назву міста..."
          className={cn(
            "pl-10 pr-10",
            error ? "border-destructive" : ""
          )}
        />
        {cityRef && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
        )}

        {/* Floating dropdown */}
        {isOpen && cities.length > 0 && (
          <div className="absolute z-[100] w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-64 overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-150">
            {cities.map((city) => (
              <button
                key={city.Ref}
                type="button"
                onClick={() => handleSelect(city)}
                className="w-full px-4 py-3 text-left hover:bg-primary/5 transition-colors border-b border-border/50 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <MapPin className="h-4 w-4 text-primary/60 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">
                      {city.Description}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {city.Present}
                    </p>
                  </div>
                  {city.Warehouses != null && city.Warehouses > 0 && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {city.Warehouses} відд.
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};
