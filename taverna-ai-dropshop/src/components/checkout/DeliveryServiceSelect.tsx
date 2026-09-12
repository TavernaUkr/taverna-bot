import { useState } from 'react';
import { Truck, Package, MapPin, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CitySearch } from './CitySearch';
import { WarehouseSelect } from './WarehouseSelect';

export type DeliveryService = 'nova_poshta' | 'ukrposhta' | 'rozetka' | 'meest' | 'justin';
export type DeliveryType = 'warehouse' | 'postomat' | 'courier' | 'fulfillment';

interface DeliveryServiceSelectProps {
  value: DeliveryService;
  onChange: (service: DeliveryService) => void;
  deliveryType: DeliveryType;
  onDeliveryTypeChange: (type: DeliveryType) => void;
}

const deliveryServices = [
  {
    id: 'nova_poshta' as DeliveryService,
    name: 'Нова Пошта',
    icon: '📦',
    description: 'Відділення, поштомати, фулфілмент',
    supportsTypes: ['warehouse', 'postomat', 'courier', 'fulfillment'] as DeliveryType[],
  },
  {
    id: 'ukrposhta' as DeliveryService,
    name: 'Укрпошта',
    icon: '📮',
    description: 'За індексом відділення',
    supportsTypes: ['warehouse', 'courier'] as DeliveryType[],
  },
  {
    id: 'rozetka' as DeliveryService,
    name: 'Rozetka Delivery',
    icon: '🛒',
    description: 'Точки видачі Rozetka',
    supportsTypes: ['warehouse'] as DeliveryType[],
  },
  {
    id: 'meest' as DeliveryService,
    name: 'Meest Express',
    icon: '✈️',
    description: 'Міжнародна та локальна доставка',
    supportsTypes: ['warehouse', 'courier'] as DeliveryType[],
  },
  {
    id: 'justin' as DeliveryService,
    name: 'Justin',
    icon: '🟡',
    description: 'Відділення у Сільпо та інших',
    supportsTypes: ['warehouse'] as DeliveryType[],
  },
];

const deliveryTypes = [
  { id: 'warehouse' as DeliveryType, name: 'Відділення', icon: Building2 },
  { id: 'postomat' as DeliveryType, name: 'Поштомат', icon: Package },
  { id: 'courier' as DeliveryType, name: "Кур'єр", icon: Truck },
  { id: 'fulfillment' as DeliveryType, name: 'Фулфілмент НП', icon: MapPin },
];

export function DeliveryServiceSelect({
  value,
  onChange,
  deliveryType,
  onDeliveryTypeChange,
}: DeliveryServiceSelectProps) {
  const selectedService = deliveryServices.find((s) => s.id === value);
  const availableTypes = deliveryTypes.filter((t) =>
    selectedService?.supportsTypes.includes(t.id)
  );

  return (
    <div className="space-y-4">
      {/* Service Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">Служба доставки</Label>
        <div className="grid grid-cols-2 gap-2">
          {deliveryServices.map((service) => (
            <button
              key={service.id}
              type="button"
              onClick={() => {
                onChange(service.id);
                // Reset delivery type if not supported
                if (!service.supportsTypes.includes(deliveryType)) {
                  onDeliveryTypeChange(service.supportsTypes[0]);
                }
              }}
              className={cn(
                'flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left',
                value === service.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{service.icon}</span>
                <span className="font-medium text-sm text-foreground">{service.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{service.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Delivery Type Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">Тип доставки</Label>
        <div className="flex gap-2 flex-wrap">
          {availableTypes.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => onDeliveryTypeChange(type.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
                  deliveryType === type.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-sm">{type.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fulfillment Info */}
      {value === 'nova_poshta' && deliveryType === 'fulfillment' && (
        <div className="p-3 bg-primary/10 rounded-xl border border-primary/20">
          <div className="flex items-start gap-2">
            <MapPin className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm text-foreground">Фулфілмент-центр НП</p>
              <p className="text-xs text-muted-foreground mt-1">
                Товари від різних постачальників зберуться на фулфілмент-складі НП 
                (визначається автоматично) та відправляться <strong>однією посилкою</strong> на обране вами відділення.
              </p>
              <p className="text-xs text-primary font-medium mt-2">
                ↓ Оберіть ваше відділення для отримання нижче
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface DeliveryFieldsProps {
  service: DeliveryService;
  deliveryType: DeliveryType;
  cityRef: string;
  city: string;
  onCitySelect: (city: { Ref: string; Description: string }) => void;
  warehouseRef: string;
  warehouseNumber: string;
  onWarehouseSelect: (warehouse: { Ref: string; Number: string }) => void;
  postalCode: string;
  onPostalCodeChange: (code: string) => void;
  pickupPoint: string;
  onPickupPointChange: (point: string) => void;
  courierAddress: string;
  onCourierAddressChange: (address: string) => void;
  errors: Record<string, string>;
}

export function DeliveryFields({
  service,
  deliveryType,
  cityRef,
  city,
  onCitySelect,
  warehouseRef,
  warehouseNumber,
  onWarehouseSelect,
  postalCode,
  onPostalCodeChange,
  pickupPoint,
  onPickupPointChange,
  courierAddress,
  onCourierAddressChange,
  errors,
}: DeliveryFieldsProps) {
  // Nova Poshta - full integration
  if (service === 'nova_poshta') {
    return (
      <div className="space-y-4">
        <CitySearch
          value={city}
          cityRef={cityRef}
          onSelect={onCitySelect}
          error={errors.city}
        />
        {(deliveryType === 'warehouse' || deliveryType === 'fulfillment') && (
          <WarehouseSelect
            cityRef={cityRef}
            value={warehouseRef}
            warehouseNumber={warehouseNumber}
            onSelect={onWarehouseSelect}
            error={errors.warehouse}
            disabled={!cityRef}
            type="branch"
            label={deliveryType === 'fulfillment' ? 'Відділення для отримання' : 'Відділення'}
          />
        )}
        {deliveryType === 'postomat' && (
          <WarehouseSelect
            cityRef={cityRef}
            value={warehouseRef}
            warehouseNumber={warehouseNumber}
            onSelect={onWarehouseSelect}
            error={errors.warehouse}
            disabled={!cityRef}
            type="postomat"
            label="Поштомат"
          />
        )}
        {deliveryType === 'courier' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">
              Адреса доставки <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={courierAddress}
              onChange={(e) => onCourierAddressChange(e.target.value)}
              placeholder="Вулиця, будинок, квартира..."
              className={errors.courierAddress ? 'border-destructive' : ''}
            />
            {errors.courierAddress && (
              <p className="text-xs text-destructive">{errors.courierAddress}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Ukrposhta - postal code
  if (service === 'ukrposhta') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Індекс відділення <span className="text-destructive">*</span>
          </Label>
          <Input
            value={postalCode}
            onChange={(e) => onPostalCodeChange(e.target.value)}
            placeholder="01001"
            maxLength={5}
            className={errors.postalCode ? 'border-destructive' : ''}
          />
          {errors.postalCode && (
            <p className="text-xs text-destructive">{errors.postalCode}</p>
          )}
        </div>
        <CitySearch
          value={city}
          cityRef={cityRef}
          onSelect={onCitySelect}
          error={errors.city}
          label="Місто (для підтвердження)"
        />
      </div>
    );
  }

  // Rozetka / Meest / Justin - text field for pickup point
  if (service === 'rozetka' || service === 'meest' || service === 'justin') {
    const placeholderText = {
      rozetka: 'Адреса магазину Rozetka',
      meest: 'Адреса відділення Meest',
      justin: 'Адреса відділення Justin (Сільпо, Le Silpo тощо)',
    };
    
    const helperText = {
      rozetka: 'Вкажіть адресу найближчої точки видачі Rozetka',
      meest: 'Вкажіть адресу відділення Meest Express',
      justin: 'Вкажіть адресу найближчого відділення Justin',
    };
    
    return (
      <div className="space-y-4">
        <CitySearch
          value={city}
          cityRef={cityRef}
          onSelect={onCitySelect}
          error={errors.city}
        />
        {deliveryType === 'warehouse' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">
              Точка видачі <span className="text-destructive">*</span>
            </Label>
            <Input
              value={pickupPoint}
              onChange={(e) => onPickupPointChange(e.target.value)}
              placeholder={placeholderText[service]}
              className={errors.pickupPoint ? 'border-destructive' : ''}
            />
            {errors.pickupPoint && (
              <p className="text-xs text-destructive">{errors.pickupPoint}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {helperText[service]}
            </p>
          </div>
        )}
        {deliveryType === 'courier' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">
              Адреса доставки <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={courierAddress}
              onChange={(e) => onCourierAddressChange(e.target.value)}
              placeholder="Вулиця, будинок, квартира..."
              className={errors.courierAddress ? 'border-destructive' : ''}
            />
            {errors.courierAddress && (
              <p className="text-xs text-destructive">{errors.courierAddress}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
