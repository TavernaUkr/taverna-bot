import { useState } from "react";
import { ArrowLeft, MapPin, Plus, Trash2, Check, Home, Building2, Briefcase, ChevronRight, Map, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { hapticImpact, hapticSelection } from "@/lib/haptics";
import { AddressForm, AddressData } from "@/components/AddressForm";
import { DeliveryMap } from "@/components/checkout/DeliveryMap";
import { motion, AnimatePresence } from "framer-motion";

interface DeliveryAddress {
  id: string;
  is_default: boolean;
  recipient_name: string;
  phone: string;
  delivery_service: string;
  city: string;
  city_ref?: string;
  delivery_type: string;
  warehouse_number?: string;
  warehouse_ref?: string;
  street_address?: string;
  building_number?: string;
  apartment?: string;
  notes?: string;
}

interface DeliveryAddressesPageProps {
  addresses: DeliveryAddress[];
  profile: { first_name?: string; last_name?: string; phone?: string } | null;
  onBack: () => void;
  onAddAddress: (address: Omit<DeliveryAddress, 'id'>) => Promise<any>;
  onUpdateAddress: (id: string, updates: Partial<DeliveryAddress>) => Promise<any>;
  onDeleteAddress: (id: string) => Promise<boolean>;
}

type ViewState = 'list' | 'add' | 'edit' | 'map';

export function DeliveryAddressesPage({
  addresses,
  profile,
  onBack,
  onAddAddress,
  onUpdateAddress,
  onDeleteAddress,
}: DeliveryAddressesPageProps) {
  const [view, setView] = useState<ViewState>('list');
  const [editingAddress, setEditingAddress] = useState<DeliveryAddress | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAddAddress = async (addressData: AddressData) => {
    setIsLoading(true);
    try {
      const result = await onAddAddress({
        ...addressData,
        is_default: addresses.length === 0 ? true : addressData.is_default || false,
      });
      if (result) {
        toast.success('Адресу додано');
        setView('list');
      }
    } catch (error) {
      toast.error('Помилка додавання адреси');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateAddress = async (addressData: AddressData) => {
    if (!editingAddress) return;
    
    setIsLoading(true);
    try {
      const result = await onUpdateAddress(editingAddress.id, addressData);
      if (result) {
        toast.success('Адресу оновлено');
        setView('list');
        setEditingAddress(null);
      }
    } catch (error) {
      toast.error('Помилка оновлення');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAddress = async (id: string) => {
    hapticImpact('medium');
    const result = await onDeleteAddress(id);
    if (result) {
      toast.success('Адресу видалено');
    } else {
      toast.error('Помилка видалення');
    }
  };

  const handleSetDefault = async (id: string) => {
    hapticImpact('light');
    // Remove default from all others
    for (const addr of addresses) {
      if (addr.is_default && addr.id !== id) {
        await onUpdateAddress(addr.id, { is_default: false });
      }
    }
    await onUpdateAddress(id, { is_default: true });
    toast.success('Основну адресу оновлено');
  };

  const handleSelectFromMap = (branch: { name: string; address: string; service: string }) => {
    hapticSelection();
    toast.success(`Обрано: ${branch.name}`);
    setView('add');
  };

  const getDeliveryServiceName = (service: string) => {
    switch (service) {
      case 'nova_poshta': return 'Нова Пошта';
      case 'ukrposhta': return 'Укрпошта';
      case 'meest': return 'Meest';
      default: return service;
    }
  };

  const getAddressIcon = (type: string, isDefault: boolean) => {
    if (isDefault) return Home;
    if (type === 'courier') return Building2;
    return Briefcase;
  };

  const getAddressLabel = (index: number, isDefault: boolean) => {
    if (isDefault) return 'Основна';
    return `Адреса ${index + 1}`;
  };

  const renderHeader = (title: string, subtitle?: string) => (
    <div className="sticky top-0 bg-card border-b border-border p-4 z-10">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (view === 'list') onBack();
            else setView('list');
          }}
          className="w-11 h-11 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="font-bold text-lg text-foreground">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );

  // Map View
  if (view === 'map') {
    return (
      <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
        {renderHeader('Карта відділень', 'Оберіть зручне відділення')}
        
        <div className="p-4">
          <DeliveryMap onSelectBranch={handleSelectFromMap} />
          
          <button
            onClick={() => setView('add')}
            className="w-full mt-4 py-3 bg-primary text-primary-foreground rounded-xl font-medium active:scale-[0.98] transition-transform"
          >
            Додати вручну
          </button>
        </div>
      </div>
    );
  }

  // Add/Edit View
  if (view === 'add' || view === 'edit') {
    const initialData = view === 'edit' && editingAddress 
      ? editingAddress as AddressData
      : {
          recipient_name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '',
          phone: profile?.phone || '',
        } as AddressData;

    return (
      <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
        {renderHeader(
          view === 'edit' ? 'Редагувати адресу' : 'Нова адреса',
          view === 'add' ? 'Додайте адресу для швидкого замовлення' : undefined
        )}
        
        <div className="p-4 pb-24">
          {/* Quick action - Find on Map */}
          {view === 'add' && (
            <button
              onClick={() => {
                hapticSelection();
                setView('map');
              }}
              className="w-full mb-4 py-4 px-4 bg-accent/10 border border-accent/30 rounded-xl flex items-center gap-3 hover:bg-accent/20 transition-colors active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                <Map className="h-6 w-6 text-accent" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium text-foreground">Знайти на мапі</p>
                <p className="text-xs text-muted-foreground">Обрати відділення або поштомат</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}

          <AddressForm
            onSubmit={view === 'edit' ? handleUpdateAddress : handleAddAddress}
            onCancel={() => {
              setView('list');
              setEditingAddress(null);
            }}
            initialData={initialData}
            isLoading={isLoading}
          />
        </div>
      </div>
    );
  }

  // List View (default)
  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-in overflow-auto">
      {renderHeader('Адреси доставки', 'Мапа відділень/поштоматів України')}
      
      <div className="p-4 space-y-3">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              hapticSelection();
              setView('map');
            }}
            className="py-4 px-4 bg-accent/10 border border-accent/30 rounded-xl flex flex-col items-center gap-2 hover:bg-accent/20 transition-colors active:scale-[0.98]"
          >
            <Map className="h-6 w-6 text-accent" />
            <span className="text-sm font-medium text-foreground">Карта відділень</span>
          </button>
          
          {addresses.length < 3 && (
            <button
              onClick={() => {
                hapticSelection();
                setView('add');
              }}
              className="py-4 px-4 bg-primary/10 border border-primary/30 rounded-xl flex flex-col items-center gap-2 hover:bg-primary/20 transition-colors active:scale-[0.98]"
            >
              <Plus className="h-6 w-6 text-primary" />
              <span className="text-sm font-medium text-foreground">Додати адресу</span>
            </button>
          )}
        </div>

        {/* Address Counter */}
        <div className="flex items-center justify-between py-2">
          <p className="text-sm text-muted-foreground">Збережені адреси</p>
          <span className={cn(
            "text-xs font-medium px-2 py-1 rounded-full",
            addresses.length >= 3 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
          )}>
            {addresses.length}/3
          </span>
        </div>

        {/* Empty State */}
        {addresses.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-20 h-20 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
              <MapPin className="h-10 w-10 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground mb-1">Немає збережених адрес</p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Додайте адресу для швидкого оформлення замовлень. Основна адреса заповнюється автоматично.
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {addresses.map((address, index) => {
              const AddressIcon = getAddressIcon(address.delivery_type, address.is_default);
              
              return (
                <motion.div
                  key={address.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={cn(
                    "relative rounded-2xl p-4 border transition-all backdrop-blur-sm",
                    "bg-card/80 hover:shadow-md",
                    address.is_default 
                      ? "border-primary/50 bg-primary/5 shadow-sm" 
                      : "border-border hover:border-primary/30"
                  )}
                >
                  {/* Default Badge */}
                  {address.is_default && (
                    <div className="absolute -top-2 left-4">
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <Home className="h-3 w-3" />
                        Основна
                      </span>
                    </div>
                  )}

                  <div className="flex items-start gap-3 pt-1">
                    {/* Address Type Icon */}
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                      address.is_default ? "bg-primary/20" : "bg-muted"
                    )}>
                      <AddressIcon className={cn(
                        "h-6 w-6",
                        address.is_default ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>

                    {/* Address Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          address.delivery_service === 'nova_poshta' && "bg-destructive/10 text-destructive",
                          address.delivery_service === 'ukrposhta' && "bg-warning/10 text-warning",
                          address.delivery_service === 'meest' && "bg-accent/10 text-accent"
                        )}>
                          {getDeliveryServiceName(address.delivery_service)}
                        </span>
                        {!address.is_default && (
                          <span className="text-xs text-muted-foreground">
                            {getAddressLabel(index, address.is_default)}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-foreground">{address.recipient_name}</p>
                      <p className="text-sm text-muted-foreground">{address.phone}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {address.city}
                        {address.warehouse_number && `, Відділення №${address.warehouse_number}`}
                        {address.street_address && `, ${address.street_address}`}
                        {address.building_number && ` ${address.building_number}`}
                        {address.apartment && `, кв. ${address.apartment}`}
                      </p>
                      {address.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          📝 {address.notes}
                        </p>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2">
                      {!address.is_default && (
                        <button
                          onClick={() => handleSetDefault(address.id)}
                          className="p-2.5 rounded-xl bg-muted/80 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all active:scale-95"
                          title="Зробити основною"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          hapticSelection();
                          setEditingAddress(address);
                          setView('edit');
                        }}
                        className="p-2.5 rounded-xl bg-muted/80 hover:bg-accent/10 text-muted-foreground hover:text-accent transition-all active:scale-95"
                        title="Редагувати"
                      >
                        <Search className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteAddress(address.id)}
                        className="p-2.5 rounded-xl bg-muted/80 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all active:scale-95"
                        title="Видалити"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {/* Info Banner */}
        <div className="mt-4 p-4 bg-muted/50 rounded-xl border border-border">
          <p className="text-sm text-muted-foreground">
            💡 <strong>Підказка:</strong> Основна адреса автоматично заповнюється при оформленні замовлення. 
            Ви можете додати до 3 адрес для різних локацій (дім, робота, родичі).
          </p>
        </div>
      </div>
    </div>
  );
}
