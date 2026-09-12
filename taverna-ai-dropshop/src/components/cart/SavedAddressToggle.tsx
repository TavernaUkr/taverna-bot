import { useState, useEffect } from 'react';
import { MapPin, ChevronDown, Check, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useTelegramAuthContext } from '@/components/TelegramAuthProvider';
import { hapticSelection } from '@/lib/haptics';

interface SavedAddress {
  id: string;
  is_default: boolean;
  recipient_name: string;
  phone: string;
  delivery_service: string;
  city: string;
  delivery_type: string;
  warehouse_number?: string;
  street_address?: string;
}

interface SavedAddressToggleProps {
  onAddressSelected: (address: SavedAddress | null) => void;
  selectedAddressId: string | null;
}

const getServiceName = (service: string) => {
  switch (service) {
    case 'nova_poshta': return 'Нова Пошта';
    case 'ukrposhta': return 'Укрпошта';
    case 'rozetka': return 'Rozetka';
    case 'meest': return 'Meest';
    case 'justin': return 'Justin';
    default: return service;
  }
};

export function SavedAddressToggle({ onAddressSelected, selectedAddressId }: SavedAddressToggleProps) {
  const { isAuthenticated, sessionToken, profile } = useTelegramAuthContext();
  const [enabled, setEnabled] = useState(false);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const loadAddresses = async () => {
      setIsLoading(true);
      try {
        // Try Telegram auth first
        if (isAuthenticated && sessionToken) {
          const { data, error } = await supabase.functions.invoke('telegram-auth', {
            body: { action: 'get_addresses', session_token: sessionToken },
          });
          if (!error && data?.addresses?.length) {
            setAddresses(data.addresses);
            const defaultAddr = data.addresses.find((a: SavedAddress) => a.is_default);
            if (defaultAddr) {
              setEnabled(true);
              onAddressSelected(defaultAddr);
            }
            return;
          }
        }

        // Fallback: query delivery_addresses directly by profile_id
        if (profile?.id) {
          const { data, error } = await supabase
            .from('delivery_addresses')
            .select('id, is_default, recipient_name, phone, delivery_service, city, delivery_type, warehouse_number, street_address')
            .eq('profile_id', profile.id)
            .order('is_default', { ascending: false });

          if (!error && data?.length) {
            setAddresses(data.map(a => ({
              ...a,
              is_default: a.is_default ?? false,
              warehouse_number: a.warehouse_number ?? undefined,
              street_address: a.street_address ?? undefined,
            })));
            const defaultAddr = data.find(a => a.is_default);
            if (defaultAddr) {
              setEnabled(true);
              onAddressSelected({
                ...defaultAddr,
                is_default: defaultAddr.is_default ?? false,
                warehouse_number: defaultAddr.warehouse_number ?? undefined,
                street_address: defaultAddr.street_address ?? undefined,
              });
            }
            return;
          }
        }

        // Last fallback: try loading all addresses for any profile (dev/test)
        const { data } = await supabase
          .from('delivery_addresses')
          .select('id, is_default, recipient_name, phone, delivery_service, city, delivery_type, warehouse_number, street_address')
          .order('is_default', { ascending: false })
          .limit(3);

        if (data?.length) {
          setAddresses(data.map(a => ({
            ...a,
            is_default: a.is_default ?? false,
            warehouse_number: a.warehouse_number ?? undefined,
            street_address: a.street_address ?? undefined,
          })));
          const defaultAddr = data.find(a => a.is_default);
          if (defaultAddr) {
            setEnabled(true);
            onAddressSelected({
              ...defaultAddr,
              is_default: defaultAddr.is_default ?? false,
              warehouse_number: defaultAddr.warehouse_number ?? undefined,
              street_address: defaultAddr.street_address ?? undefined,
            });
          }
        }
      } catch (err) {
        console.error('Load addresses error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadAddresses();
  }, [isAuthenticated, sessionToken, profile?.id]);

  if (addresses.length === 0 && !isLoading) return null;

  const selectedAddress = addresses.find(a => a.id === selectedAddressId) || 
    addresses.find(a => a.is_default) || addresses[0];

  const handleToggle = (checked: boolean) => {
    hapticSelection();
    setEnabled(checked);
    if (checked) {
      onAddressSelected(selectedAddress || null);
    } else {
      onAddressSelected(null);
    }
  };

  const handleSelectAddress = (address: SavedAddress) => {
    hapticSelection();
    onAddressSelected(address);
    setShowDropdown(false);
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm text-foreground">Збережена адреса</p>
            <p className="text-xs text-muted-foreground">Автозаповнення при оформленні</p>
          </div>
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <Switch checked={enabled} onCheckedChange={handleToggle} />
        )}
      </div>

      {enabled && selectedAddress && (
        <button
          type="button"
          onClick={() => setShowDropdown(!showDropdown)}
          className={cn(
            "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
            "bg-background/50 border-border hover:border-primary/40"
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium text-primary">
                {getServiceName(selectedAddress.delivery_service)}
              </span>
              {selectedAddress.is_default && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Основна</span>
              )}
            </div>
            <p className="text-sm text-foreground truncate">
              {selectedAddress.city}
              {selectedAddress.warehouse_number && `, Відділення №${selectedAddress.warehouse_number}`}
              {selectedAddress.street_address && `, ${selectedAddress.street_address}`}
            </p>
            <p className="text-xs text-muted-foreground">{selectedAddress.recipient_name}</p>
          </div>
          {addresses.length > 1 && (
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showDropdown && "rotate-180")} />
          )}
        </button>
      )}

      {enabled && showDropdown && addresses.length > 1 && (
        <div className="space-y-2 pt-1">
          {addresses.filter(a => a.id !== selectedAddressId).map(address => (
            <button
              key={address.id}
              type="button"
              onClick={() => handleSelectAddress(address)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-background/30 hover:bg-primary/5 transition-all text-left"
            >
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-muted-foreground">
                  {getServiceName(address.delivery_service)}
                </span>
                <p className="text-sm text-foreground truncate">
                  {address.city}
                  {address.warehouse_number && `, Відділення №${address.warehouse_number}`}
                </p>
              </div>
              <Check className="h-4 w-4 text-transparent" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
