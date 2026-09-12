import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  DeliveryServiceSelect,
  DeliveryFields,
  DeliveryService,
  DeliveryType,
} from '@/components/checkout/DeliveryServiceSelect';
import { PhoneInput } from '@/components/checkout/PhoneInput';

interface AddressFormProps {
  onSubmit: (address: AddressData) => Promise<void>;
  onCancel: () => void;
  initialData?: AddressData;
  isLoading?: boolean;
}

export interface AddressData {
  id?: string;
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
  postal_code?: string;
  notes?: string;
  is_default?: boolean;
}

export function AddressForm({ onSubmit, onCancel, initialData, isLoading }: AddressFormProps) {
  const [formData, setFormData] = useState<AddressData>({
    recipient_name: initialData?.recipient_name || '',
    phone: initialData?.phone || '',
    delivery_service: initialData?.delivery_service || 'nova_poshta',
    city: initialData?.city || '',
    city_ref: initialData?.city_ref || '',
    delivery_type: initialData?.delivery_type || 'warehouse',
    warehouse_number: initialData?.warehouse_number || '',
    warehouse_ref: initialData?.warehouse_ref || '',
    street_address: initialData?.street_address || '',
    building_number: initialData?.building_number || '',
    apartment: initialData?.apartment || '',
    postal_code: initialData?.postal_code || '',
    notes: initialData?.notes || '',
    is_default: initialData?.is_default || false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Delivery-specific state
  const [pickupPoint, setPickupPoint] = useState('');
  const [courierAddress, setCourierAddress] = useState(
    initialData?.street_address
      ? `${initialData.street_address}${initialData.building_number ? ` ${initialData.building_number}` : ''}${initialData.apartment ? `, кв. ${initialData.apartment}` : ''}`
      : ''
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors: Record<string, string> = {};
    if (!formData.recipient_name.trim()) newErrors.recipient_name = "Введіть ім'я";
    if (!formData.phone || formData.phone.length < 10) newErrors.phone = 'Введіть телефон';

    if (formData.delivery_service === 'nova_poshta') {
      if (!formData.city_ref) newErrors.city = 'Оберіть місто';
      if (
        (formData.delivery_type === 'warehouse' ||
          formData.delivery_type === 'postomat' ||
          formData.delivery_type === 'fulfillment') &&
        !formData.warehouse_ref
      ) {
        newErrors.warehouse = 'Оберіть відділення';
      }
      if (formData.delivery_type === 'courier' && !courierAddress.trim()) {
        newErrors.courierAddress = 'Введіть адресу';
      }
    } else if (formData.delivery_service === 'ukrposhta') {
      if (!formData.postal_code || formData.postal_code.length < 5) {
        newErrors.postalCode = 'Введіть індекс';
      }
    } else {
      if (!formData.city_ref) newErrors.city = 'Оберіть місто';
      if (formData.delivery_type === 'warehouse' && !pickupPoint.trim()) {
        newErrors.pickupPoint = 'Введіть точку видачі';
      }
      if (formData.delivery_type === 'courier' && !courierAddress.trim()) {
        newErrors.courierAddress = 'Введіть адресу';
      }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    // Build final data
    const finalData: AddressData = {
      ...formData,
      street_address: courierAddress || pickupPoint || undefined,
    };

    await onSubmit(finalData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Recipient */}
      <div className="space-y-4">
        <h3 className="font-medium text-foreground">Отримувач</h3>

        <div className="space-y-2">
          <Label>ПІБ отримувача <span className="text-destructive">*</span></Label>
          <Input
            value={formData.recipient_name}
            onChange={(e) => setFormData((p) => ({ ...p, recipient_name: e.target.value }))}
            placeholder="Іванов Іван Іванович"
            className={errors.recipient_name ? 'border-destructive' : ''}
          />
          {errors.recipient_name && <p className="text-xs text-destructive">{errors.recipient_name}</p>}
        </div>

        <PhoneInput
          value={formData.phone}
          onChange={(phone) => setFormData((p) => ({ ...p, phone }))}
          error={errors.phone}
        />
      </div>

      {/* Delivery Service & Type */}
      <div className="space-y-4">
        <h3 className="font-medium text-foreground">Доставка</h3>

        <DeliveryServiceSelect
          value={formData.delivery_service as DeliveryService}
          onChange={(service) =>
            setFormData((p) => ({
              ...p,
              delivery_service: service,
              warehouse_number: '',
              warehouse_ref: '',
              city: '',
              city_ref: '',
            }))
          }
          deliveryType={formData.delivery_type as DeliveryType}
          onDeliveryTypeChange={(deliveryType) =>
            setFormData((p) => ({
              ...p,
              delivery_type: deliveryType,
              warehouse_number: '',
              warehouse_ref: '',
            }))
          }
        />

        <DeliveryFields
          service={formData.delivery_service as DeliveryService}
          deliveryType={formData.delivery_type as DeliveryType}
          cityRef={formData.city_ref || ''}
          city={formData.city}
          onCitySelect={(city) =>
            setFormData((p) => ({
              ...p,
              city: city.Description,
              city_ref: city.Ref,
              warehouse_number: '',
              warehouse_ref: '',
            }))
          }
          warehouseRef={formData.warehouse_ref || ''}
          warehouseNumber={formData.warehouse_number || ''}
          onWarehouseSelect={(warehouse) =>
            setFormData((p) => ({
              ...p,
              warehouse_number: warehouse.Number,
              warehouse_ref: warehouse.Ref,
            }))
          }
          postalCode={formData.postal_code || ''}
          onPostalCodeChange={(code) => setFormData((p) => ({ ...p, postal_code: code }))}
          pickupPoint={pickupPoint}
          onPickupPointChange={setPickupPoint}
          courierAddress={courierAddress}
          onCourierAddressChange={setCourierAddress}
          errors={errors}
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>Примітка (необов'язково)</Label>
        <Textarea
          value={formData.notes || ''}
          onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Додаткова інформація для кур'єра..."
          className="resize-none h-20"
        />
      </div>

      {/* Default toggle */}
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
        <div>
          <p className="text-sm font-medium text-foreground">Зробити основною</p>
          <p className="text-xs text-muted-foreground">Автоматично заповнюватиметься в кошику</p>
        </div>
        <Switch
          checked={formData.is_default || false}
          onCheckedChange={(checked) => setFormData((p) => ({ ...p, is_default: checked }))}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={isLoading}>
          Скасувати
        </Button>
        <Button type="submit" className="flex-1" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Збереження...
            </>
          ) : (
            'Зберегти'
          )}
        </Button>
      </div>
    </form>
  );
}
