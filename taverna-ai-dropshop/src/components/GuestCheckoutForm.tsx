import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, MapPin, Building2, Truck, User, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface GuestCheckoutFormProps {
  onDataChange: (data: GuestCheckoutData, isValid: boolean) => void;
  initialData?: GuestCheckoutData;
}

export interface GuestCheckoutData {
  recipient_name: string;
  phone: string;
  email: string;
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

interface City {
  ref: string;
  name: string;
  area: string;
}

interface Warehouse {
  ref: string;
  number: string;
  description: string;
  address: string;
}

export function GuestCheckoutForm({ onDataChange, initialData }: GuestCheckoutFormProps) {
  const [formData, setFormData] = useState<GuestCheckoutData>({
    recipient_name: initialData?.recipient_name || '',
    phone: initialData?.phone || '',
    email: initialData?.email || '',
    delivery_service: initialData?.delivery_service || 'nova_poshta',
    city: initialData?.city || '',
    city_ref: initialData?.city_ref || '',
    delivery_type: initialData?.delivery_type || 'warehouse',
    warehouse_number: initialData?.warehouse_number || '',
    warehouse_ref: initialData?.warehouse_ref || '',
    street_address: initialData?.street_address || '',
    building_number: initialData?.building_number || '',
    apartment: initialData?.apartment || '',
    notes: initialData?.notes || '',
  });

  const [cities, setCities] = useState<City[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [citySearch, setCitySearch] = useState(initialData?.city || '');
  const [isSearchingCities, setIsSearchingCities] = useState(false);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false);
  const [showCityDropdown, setShowCityDropdown] = useState(false);

  // Validate form
  const isFormValid = () => {
    const basicValid = formData.recipient_name.length >= 2 && 
                       formData.phone.length >= 10 && 
                       formData.city.length >= 2;
    
    if (formData.delivery_type === 'warehouse') {
      return basicValid && !!formData.warehouse_number;
    }
    return basicValid && !!formData.street_address && !!formData.building_number;
  };

  // Notify parent of changes
  useEffect(() => {
    onDataChange(formData, isFormValid());
  }, [formData]);

  // Search cities
  useEffect(() => {
    const searchCities = async () => {
      if (citySearch.length < 2) {
        setCities([]);
        return;
      }

      setIsSearchingCities(true);
      try {
        const { data, error } = await supabase.functions.invoke('nova-poshta', {
          body: { action: 'searchCities', query: citySearch },
        });

        if (!error && data?.cities) {
          setCities(data.cities);
        }
      } catch (err) {
        console.error('City search error:', err);
      } finally {
        setIsSearchingCities(false);
      }
    };

    const debounce = setTimeout(searchCities, 300);
    return () => clearTimeout(debounce);
  }, [citySearch]);

  // Load warehouses when city is selected
  useEffect(() => {
    const loadWarehouses = async () => {
      if (!formData.city_ref) {
        setWarehouses([]);
        return;
      }

      setIsLoadingWarehouses(true);
      try {
        const { data, error } = await supabase.functions.invoke('nova-poshta', {
          body: { action: 'getWarehouses', cityRef: formData.city_ref },
        });

        if (!error && data?.warehouses) {
          setWarehouses(data.warehouses);
        }
      } catch (err) {
        console.error('Warehouses load error:', err);
      } finally {
        setIsLoadingWarehouses(false);
      }
    };

    if (formData.delivery_type === 'warehouse') {
      loadWarehouses();
    }
  }, [formData.city_ref, formData.delivery_type]);

  const handleCitySelect = (city: City) => {
    setFormData(prev => ({
      ...prev,
      city: city.name,
      city_ref: city.ref,
      warehouse_number: '',
      warehouse_ref: '',
    }));
    setCitySearch(city.name);
    setShowCityDropdown(false);
  };

  const handleWarehouseSelect = (warehouse: Warehouse) => {
    setFormData(prev => ({
      ...prev,
      warehouse_number: warehouse.number,
      warehouse_ref: warehouse.ref,
    }));
  };

  const updateField = (field: keyof GuestCheckoutData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Personal Info */}
      <div className="space-y-4">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          Контактні дані
        </h3>
        
        <div className="space-y-2">
          <Label htmlFor="guest_name">ПІБ отримувача *</Label>
          <Input
            id="guest_name"
            value={formData.recipient_name}
            onChange={(e) => updateField('recipient_name', e.target.value)}
            placeholder="Іванов Іван Іванович"
            className="bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="guest_phone">Телефон *</Label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="guest_phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="+380XXXXXXXXX"
              className="pl-10 bg-background"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="guest_email">Email (необов'язково)</Label>
          <Input
            id="guest_email"
            type="email"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="email@example.com"
            className="bg-background"
          />
        </div>
      </div>

      {/* Delivery Service */}
      <div className="space-y-4">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" />
          Служба доставки
        </h3>
        
        <RadioGroup
          value={formData.delivery_service}
          onValueChange={(value) => updateField('delivery_service', value)}
          className="grid grid-cols-2 gap-3"
        >
          <div className="flex items-center space-x-2 border border-border rounded-lg p-3 cursor-pointer hover:bg-muted bg-background">
            <RadioGroupItem value="nova_poshta" id="guest_nova_poshta" />
            <Label htmlFor="guest_nova_poshta" className="cursor-pointer flex items-center gap-2 text-sm">
              <Truck className="h-4 w-4 text-primary" />
              Нова Пошта
            </Label>
          </div>
          <div className="flex items-center space-x-2 border border-border rounded-lg p-3 cursor-pointer opacity-50 bg-background">
            <RadioGroupItem value="ukr_poshta" id="guest_ukr_poshta" disabled />
            <Label htmlFor="guest_ukr_poshta" className="cursor-pointer text-sm">Укрпошта</Label>
          </div>
        </RadioGroup>
      </div>

      {/* Delivery Type */}
      <div className="space-y-4">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          Спосіб отримання
        </h3>
        
        <RadioGroup
          value={formData.delivery_type}
          onValueChange={(value) => updateField('delivery_type', value)}
          className="grid grid-cols-2 gap-3"
        >
          <div className="flex items-center space-x-2 border border-border rounded-lg p-3 cursor-pointer hover:bg-muted bg-background">
            <RadioGroupItem value="warehouse" id="guest_warehouse" />
            <Label htmlFor="guest_warehouse" className="cursor-pointer flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4" />
              На відділення
            </Label>
          </div>
          <div className="flex items-center space-x-2 border border-border rounded-lg p-3 cursor-pointer hover:bg-muted bg-background">
            <RadioGroupItem value="courier" id="guest_courier" />
            <Label htmlFor="guest_courier" className="cursor-pointer flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4" />
              Кур'єром
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* City Search */}
      <div className="space-y-2 relative">
        <Label htmlFor="guest_city">Місто *</Label>
        <div className="relative">
          <Input
            id="guest_city"
            value={citySearch}
            onChange={(e) => {
              setCitySearch(e.target.value);
              setShowCityDropdown(true);
            }}
            onFocus={() => setShowCityDropdown(true)}
            placeholder="Почніть вводити назву міста..."
            className="bg-background"
          />
          {isSearchingCities && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {showCityDropdown && cities.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {cities.map((city) => (
              <button
                key={city.ref}
                type="button"
                onClick={() => handleCitySelect(city)}
                className="w-full px-4 py-3 text-left hover:bg-muted transition-colors border-b border-border last:border-b-0"
              >
                <div className="font-medium text-sm">{city.name}</div>
                {city.area && (
                  <div className="text-xs text-muted-foreground">{city.area} обл.</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Warehouse Selection */}
      {formData.delivery_type === 'warehouse' && formData.city_ref && (
        <div className="space-y-2">
          <Label>Відділення *</Label>
          {isLoadingWarehouses ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Завантаження відділень...</span>
            </div>
          ) : (
            <select
              value={formData.warehouse_ref || ''}
              onChange={(e) => {
                const warehouse = warehouses.find(w => w.ref === e.target.value);
                if (warehouse) handleWarehouseSelect(warehouse);
              }}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="">Оберіть відділення</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.ref} value={warehouse.ref}>
                  №{warehouse.number} - {warehouse.description}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Courier Address */}
      {formData.delivery_type === 'courier' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guest_street">Вулиця *</Label>
            <Input
              id="guest_street"
              value={formData.street_address || ''}
              onChange={(e) => updateField('street_address', e.target.value)}
              placeholder="вул. Хрещатик"
              className="bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="guest_building">Будинок *</Label>
              <Input
                id="guest_building"
                value={formData.building_number || ''}
                onChange={(e) => updateField('building_number', e.target.value)}
                placeholder="10"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest_apartment">Квартира</Label>
              <Input
                id="guest_apartment"
                value={formData.apartment || ''}
                onChange={(e) => updateField('apartment', e.target.value)}
                placeholder="25"
                className="bg-background"
              />
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="guest_notes">Коментар (необов'язково)</Label>
        <textarea
          id="guest_notes"
          value={formData.notes || ''}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="Додаткові побажання до замовлення..."
          className="w-full h-20 p-3 rounded-lg border border-input bg-background text-sm resize-none"
        />
      </div>
    </div>
  );
}
