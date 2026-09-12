import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Check, ChevronRight, ShoppingBag, Truck, User, Gift, Tag, Info, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTelegramAuthContext } from './TelegramAuthProvider';
import { CartItem } from '@/hooks/useCart';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { hapticNotification } from '@/lib/haptics';
import { useBonuses } from '@/hooks/useBonuses';

// Import new checkout components
import { CheckoutSteps, CheckoutStep } from './checkout/CheckoutSteps';
import { PhoneInput } from './checkout/PhoneInput';
import { CitySearch } from './checkout/CitySearch';
import { WarehouseSelect } from './checkout/WarehouseSelect';
import { PaymentMethodSelect, PaymentMethod, PaymentType } from './checkout/PaymentMethodSelect';
import { OrderSummary } from './checkout/OrderSummary';
import { CheckoutDiscounts } from './checkout/CheckoutDiscounts';
import { 
  DeliveryServiceSelect, 
  DeliveryFields, 
  DeliveryService, 
  DeliveryType 
} from './checkout/DeliveryServiceSelect';
import { DeliveryEstimate } from './checkout/DeliveryEstimate';
import { WalletPayment } from './checkout/WalletPayment';
import { useWallet } from '@/hooks/useWallet';

const PROMO_STORAGE_KEY = "taverna_active_promo";

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onOrderComplete: (orderId: string) => void;
}

interface ContactData {
  firstName: string;
  lastName: string;
  phone: string;
}

interface DeliveryData {
  service: DeliveryService;
  deliveryType: DeliveryType;
  city: string;
  cityRef: string;
  warehouse: string;
  warehouseRef: string;
  postalCode: string;
  pickupPoint: string;
  courierAddress: string;
}

interface PersonalBonus {
  id: string;
  title: string;
  description: string;
  value: string;
  discountPercent?: number;
  discountAmount?: number;
  icon: string;
}

export function CheckoutModal({ isOpen, onClose, items, onOrderComplete }: CheckoutModalProps) {
  const { isAuthenticated, profile, sessionToken, addresses: savedAddresses, effectiveRole } = useTelegramAuthContext() as any;
  
  // Step management
  const [currentStep, setCurrentStep] = useState<CheckoutStep>('contact');
  const [completedSteps, setCompletedSteps] = useState<CheckoutStep[]>([]);
  
  // Contact data
  const [contactData, setContactData] = useState<ContactData>({
    firstName: '',
    lastName: '',
    phone: '',
  });
  
  // Delivery data
  const [deliveryData, setDeliveryData] = useState<DeliveryData>({
    service: 'nova_poshta',
    deliveryType: 'warehouse',
    city: '',
    cityRef: '',
    warehouse: '',
    warehouseRef: '',
    postalCode: '',
    pickupPoint: '',
    courierAddress: '',
  });
  
  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentType, setPaymentType] = useState<PaymentType>('full_prepayment');
  const { payWithBalance } = useWallet();
  const [walletOrder, setWalletOrder] = useState<{ id: string; number?: string | null } | null>(null);
  const [orderNotes, setOrderNotes] = useState('');
  
  // Promo & Bonuses - real data
  const { balance: bonusBalance, spendBonuses } = useBonuses();
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoDbId, setPromoDbId] = useState<string | null>(null);
  const [bonusesToUse, setBonusesToUse] = useState(0);
  const [personalBonuses, setPersonalBonuses] = useState<PersonalBonus[]>([]);
  const [selectedPersonalBonus, setSelectedPersonalBonus] = useState<PersonalBonus | null>(null);
  const [orderCount, setOrderCount] = useState(0);
  
  // Saved address selection
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState<string | null>(null);
  
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Calculate totals with discounts
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryCost = 70;
  const personalBonusDiscount = selectedPersonalBonus?.discountPercent
    ? Math.round(subtotal * selectedPersonalBonus.discountPercent / 100)
    : selectedPersonalBonus?.discountAmount || 0;
  const total = Math.max(0, subtotal + deliveryCost - promoDiscount - bonusesToUse - personalBonusDiscount);

  // Amount to pay now depends on selected payment type
  const amountToPayNow = paymentType === 'full_prepayment'
    ? total
    : paymentType === 'markup_only'
    ? Math.round(total * 0.25)
    : 0;

  // Load personal bonuses for checkout
  useEffect(() => {
    const loadPersonalBonuses = async () => {
      if (!isAuthenticated || !profile?.id) return;
      try {
        const { data: orders } = await supabase
          .from("orders")
          .select("id, total")
          .eq("profile_id", profile.id)
          .limit(20);

        const totalOrders = orders?.length || 0;
        setOrderCount(totalOrders);
        const totalSpending = orders?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;
        const bonuses: PersonalBonus[] = [];
        const cashbackRate = Math.min(5 + totalOrders, 15);

        bonuses.push({
          id: "cashback",
          title: `Кешбек ${cashbackRate}%`,
          description: "На це замовлення",
          value: `-${cashbackRate}%`,
          discountPercent: cashbackRate,
          icon: "💰",
        });

        if (totalSpending > 5000) {
          bonuses.push({
            id: "delivery",
            title: "Безкоштовна доставка",
            description: "VIP-привілей",
            value: "-70₴",
            discountAmount: 70,
            icon: "🚚",
          });
        }

        if (totalOrders < 3) {
          bonuses.push({
            id: "welcome",
            title: "-20% на замовлення",
            description: `Залишилось: ${3 - totalOrders}`,
            value: "-20%",
            discountPercent: 20,
            icon: "🎁",
          });
        }

        bonuses.push({
          id: "category",
          title: "-10% на улюблену категорію",
          description: "Тактичне спорядження",
          value: "-10%",
          discountPercent: 10,
          icon: "🎯",
        });

        if (totalOrders >= 10) {
          bonuses.push({
            id: "vip",
            title: "VIP -15%",
            description: "Ексклюзивна знижка",
            value: "-15%",
            discountPercent: 15,
            icon: "👑",
          });
        }

        setPersonalBonuses(bonuses);
      } catch (err) {
        console.error("Error loading personal bonuses:", err);
      }
    };
    loadPersonalBonuses();
  }, [isAuthenticated, profile?.id]);

  // Apply promo code from DB
  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    try {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", promoCode.trim())
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error("Промокод не знайдено або він неактивний");
        return;
      }
      if (data.max_uses && (data.current_uses || 0) >= data.max_uses) {
        toast.error("Промокод вичерпано");
        return;
      }
      if (data.min_order_amount && subtotal < data.min_order_amount) {
        toast.error(`Мінімальна сума замовлення: ${data.min_order_amount}₴`);
        return;
      }
      if (data.valid_until && new Date(data.valid_until) < new Date()) {
        toast.error("Термін дії промокоду вичерпано");
        return;
      }

      const discount = data.discount_percent
        ? Math.round(subtotal * data.discount_percent / 100)
        : data.discount_amount || 0;

      setPromoDiscount(discount);
      setPromoApplied(true);
      setPromoDbId(data.id);
      hapticNotification("success");
      toast.success(`Промокод застосовано! Знижка: ${discount}₴`);
    } catch (err) {
      console.error("Promo error:", err);
      toast.error("Помилка перевірки промокоду");
    }
  };

  const handleRemovePromo = () => {
    setPromoCode("");
    setPromoDiscount(0);
    setPromoApplied(false);
    setPromoDbId(null);
    localStorage.removeItem(PROMO_STORAGE_KEY);
  };

  // Initialize with user data if authenticated
  useEffect(() => {
    if (isAuthenticated && profile) {
      setContactData({
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        phone: profile.phone || '',
      });
    }
  }, [isAuthenticated, profile]);

  // Count unique suppliers
  const uniqueSuppliers = new Set(items.map(i => i.supplierId).filter(Boolean));
  const isMultiSupplier = uniqueSuppliers.size > 1;

  // Auto-fill from saved address
  const handleSelectSavedAddress = (addressId: string | null) => {
    setSelectedSavedAddressId(addressId);
    
    if (!addressId) return;
    
    const address = savedAddresses.find(a => a.id === addressId);
    if (!address) return;
    
    // Auto-fill contact data from saved address
    if (address.recipient_name) {
      const nameParts = address.recipient_name.split(' ');
      setContactData(prev => ({
        firstName: nameParts[0] || prev.firstName,
        lastName: nameParts.slice(1).join(' ') || prev.lastName,
        phone: address.phone || prev.phone,
      }));
    }
    
    // Auto-fill delivery data
    setDeliveryData(prev => ({
      ...prev,
      service: (address.delivery_service as DeliveryService) || prev.service,
      deliveryType: (address.delivery_type as DeliveryType) || prev.deliveryType,
      city: address.city || prev.city,
      cityRef: address.city_ref || prev.cityRef,
      warehouse: address.warehouse_number || prev.warehouse,
      warehouseRef: address.warehouse_ref || prev.warehouseRef,
    }));
  };

  // Reset state when modal opens and load promo from storage
  useEffect(() => {
    if (isOpen) {
      setCurrentStep('contact');
      setCompletedSteps([]);
      setErrors({});
      setBonusesToUse(0);
      setSelectedSavedAddressId(null);
      
      // Load promo from localStorage
      const storedPromo = localStorage.getItem(PROMO_STORAGE_KEY);
      if (storedPromo) {
        try {
          const parsed = JSON.parse(storedPromo);
          if (parsed.code) {
            setPromoCode(parsed.code);
          }
        } catch {
          // ignore
        }
      }
      setPromoApplied(false);
      setPromoDiscount(0);
      setPromoDbId(null);
      setSelectedPersonalBonus(null);
      
      if (!isAuthenticated) {
        setContactData({ firstName: '', lastName: '', phone: '' });
      }

      // Auto-select fulfillment for multi-supplier orders
      const autoService: DeliveryService = 'nova_poshta';
      const autoType: DeliveryType = isMultiSupplier ? 'fulfillment' : 'warehouse';

      // Pre-fill from default saved address if available
      const defaultAddress = savedAddresses.find(a => a.is_default) || savedAddresses[0];
      
      if (defaultAddress) {
        setSelectedSavedAddressId(defaultAddress.id);
        
        // Auto-fill contact from saved address
        if (defaultAddress.recipient_name) {
          const nameParts = defaultAddress.recipient_name.split(' ');
          setContactData({
            firstName: nameParts[0] || profile?.first_name || '',
            lastName: nameParts.slice(1).join(' ') || profile?.last_name || '',
            phone: defaultAddress.phone || profile?.phone || '',
          });
        } else if (isAuthenticated && profile) {
          setContactData({
            firstName: profile.first_name || '',
            lastName: profile.last_name || '',
            phone: profile.phone || '',
          });
        }
        
        setDeliveryData({
          service: (defaultAddress.delivery_service as DeliveryService) || autoService,
          deliveryType: isMultiSupplier ? 'fulfillment' : (defaultAddress.delivery_type as DeliveryType) || autoType,
          city: defaultAddress.city || '',
          cityRef: defaultAddress.city_ref || '',
          warehouse: defaultAddress.warehouse_number || '',
          warehouseRef: defaultAddress.warehouse_ref || '',
          postalCode: '',
          pickupPoint: '',
          courierAddress: '',
        });
      } else if (isAuthenticated && profile) {
        setContactData({
          firstName: profile.first_name || '',
          lastName: profile.last_name || '',
          phone: profile.phone || '',
        });
        setDeliveryData({
          service: autoService,
          deliveryType: autoType,
          city: (profile as any).last_city || '',
          cityRef: (profile as any).last_city_ref || '',
          warehouse: (profile as any).last_warehouse || '',
          warehouseRef: (profile as any).last_warehouse_ref || '',
          postalCode: '',
          pickupPoint: '',
          courierAddress: '',
        });
      } else {
        setDeliveryData({ 
          service: autoService,
          deliveryType: autoType,
          city: '', 
          cityRef: '', 
          warehouse: '', 
          warehouseRef: '',
          postalCode: '',
          pickupPoint: '',
          courierAddress: '',
        });
      }
      setPaymentMethod('cash');
      setPaymentType('full_prepayment');
      setOrderNotes('');
    }
  }, [isOpen, isAuthenticated, profile, isMultiSupplier, savedAddresses]);

  if (!isOpen) return null;

  // Validation
  const validateContact = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!contactData.firstName.trim()) {
      newErrors.firstName = "Введіть ім'я";
    }
    if (!contactData.lastName.trim()) {
      newErrors.lastName = "Введіть прізвище";
    }
    if (!contactData.phone || contactData.phone.length !== 12) {
      newErrors.phone = "Введіть повний номер телефону";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateDelivery = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    // If a saved address is selected with valid data, skip detailed validation
    if (selectedSavedAddressId && deliveryData.cityRef && deliveryData.warehouseRef) {
      setErrors(newErrors);
      return true;
    }
    
    // Common validation for all services
    if (deliveryData.service === 'nova_poshta') {
      if (!deliveryData.cityRef) {
        newErrors.city = "Оберіть місто";
      }
      if ((deliveryData.deliveryType === 'warehouse' || 
           deliveryData.deliveryType === 'postomat' || 
           deliveryData.deliveryType === 'fulfillment') && 
          !deliveryData.warehouseRef) {
        newErrors.warehouse = "Оберіть відділення";
      }
      if (deliveryData.deliveryType === 'courier' && !deliveryData.courierAddress.trim()) {
        newErrors.courierAddress = "Введіть адресу доставки";
      }
    } else if (deliveryData.service === 'ukrposhta') {
      if (!deliveryData.postalCode || deliveryData.postalCode.length < 5) {
        newErrors.postalCode = "Введіть поштовий індекс";
      }
    } else if (deliveryData.service === 'rozetka' || deliveryData.service === 'meest') {
      if (!deliveryData.cityRef) {
        newErrors.city = "Оберіть місто";
      }
      if (deliveryData.deliveryType === 'warehouse' && !deliveryData.pickupPoint.trim()) {
        newErrors.pickupPoint = "Введіть точку видачі";
      }
      if (deliveryData.deliveryType === 'courier' && !deliveryData.courierAddress.trim()) {
        newErrors.courierAddress = "Введіть адресу доставки";
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Step navigation
  const goToStep = (step: CheckoutStep) => {
    setCurrentStep(step);
  };

  const handleNextFromContact = () => {
    if (validateContact()) {
      setCompletedSteps((prev) => [...prev.filter(s => s !== 'contact'), 'contact']);
      goToStep('delivery');
    }
  };

  const handleNextFromDelivery = () => {
    if (validateDelivery()) {
      setCompletedSteps((prev) => [...prev.filter(s => s !== 'delivery'), 'delivery']);
      goToStep('payment');
    }
  };

  const handleNextFromPayment = () => {
    setCompletedSteps((prev) => [...prev.filter(s => s !== 'payment'), 'payment']);
    goToStep('confirm');
  };

  const handleSubmitOrder = async () => {
    setIsSubmitting(true);

    try {
      const orderData = {
        payment_method: paymentMethod,
        delivery_cost: deliveryCost,
        subtotal: subtotal,
        total: total,
        notes: orderNotes || null,
        items: items.map(item => ({
          product_id: item.productId,
          product_name: item.name,
          product_image: item.image,
          price: item.price,
          quantity: item.quantity,
          size: item.size || null,
          color: item.color || null,
          total: item.price * item.quantity,
        })),
      };

      if (isAuthenticated && sessionToken) {
        // Authenticated order - first save address
        const { data, error } = await supabase.functions.invoke('telegram-auth', {
          body: {
            action: 'create_order',
            session_token: sessionToken,
            guest_info: {
              recipient_name: `${contactData.firstName} ${contactData.lastName}`,
              phone: contactData.phone,
              city: deliveryData.city,
              city_ref: deliveryData.cityRef,
              warehouse_number: deliveryData.warehouse,
              warehouse_ref: deliveryData.warehouseRef,
              delivery_type: 'warehouse',
              delivery_service: 'nova_poshta',
            },
            order: orderData,
          },
        });

        if (error) throw error;

        if (data?.success && data?.order) {
          // Spend bonuses if used
          if (bonusesToUse > 0) {
            await spendBonuses(bonusesToUse);
          }
          // Track promo usage
          if (promoApplied && promoDbId && profile?.id) {
            await supabase.from("used_promo_codes").insert({
              profile_id: profile.id,
              promo_code_id: promoDbId,
              order_id: data.order.id,
            });
            await supabase.from("promo_codes").update({
              current_uses: (await supabase.from("promo_codes").select("current_uses").eq("id", promoDbId).single()).data?.current_uses! + 1,
            }).eq("id", promoDbId);
            localStorage.removeItem(PROMO_STORAGE_KEY);
          }
          toast.success(`Замовлення #${data.order.order_number} створено!`);
          if (paymentMethod === 'taverna_balance') {
            try {
              await payWithBalance(data.order.id, true);
              toast.success('Оплачено з рахунку Taverna');
            } catch {
              toast.error('Недостатньо коштів на рахунку');
            }
            onOrderComplete(data.order.id);
            return;
          }
          if (paymentMethod === 'telegram_wallet') {
            setWalletOrder({ id: data.order.id, number: data.order.order_number });
            return;
          }
          onOrderComplete(data.order.id);
        } else {
          throw new Error(data?.error || 'Failed to create order');
        }
      } else {
        // Guest order
        const { data, error } = await supabase.functions.invoke('telegram-auth', {
          body: {
            action: 'create_guest_order',
            guest_info: {
              recipient_name: `${contactData.firstName} ${contactData.lastName}`,
              phone: contactData.phone,
              city: deliveryData.city,
              city_ref: deliveryData.cityRef,
              warehouse_number: deliveryData.warehouse,
              warehouse_ref: deliveryData.warehouseRef,
              delivery_type: 'warehouse',
              delivery_service: 'nova_poshta',
            },
            order: orderData,
          },
        });

        if (error) throw error;

        if (data?.success && data?.order) {
          toast.success(`Замовлення #${data.order.order_number} створено!`);
          if (paymentMethod === 'taverna_balance') {
            try {
              await payWithBalance(data.order.id, true);
              toast.success('Оплачено з рахунку Taverna');
            } catch {
              toast.error('Недостатньо коштів на рахунку');
            }
            onOrderComplete(data.order.id);
            return;
          }
          if (paymentMethod === 'telegram_wallet') {
            setWalletOrder({ id: data.order.id, number: data.order.order_number });
            return;
          }
          onOrderComplete(data.order.id);
        } else {
          throw new Error(data?.error || 'Failed to create order');
        }
      }
    } catch (err) {
      console.error('Order creation error:', err);
      toast.error('Помилка створення замовлення');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render Contact Step
  const renderContactStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
        <User className="h-6 w-6 text-muted-foreground" />
        <div>
          <h3 className="font-medium text-foreground">Контактні дані</h3>
          <p className="text-xs text-muted-foreground">
            {isAuthenticated ? 'Підтвердіть ваші дані' : 'Заповніть контактну інформацію'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Ім'я <span className="text-destructive">*</span>
          </Label>
          <Input
            value={contactData.firstName}
            onChange={(e) => setContactData(prev => ({ ...prev, firstName: e.target.value }))}
            placeholder="Олександр"
            className={errors.firstName ? 'border-destructive' : ''}
          />
          {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Прізвище <span className="text-destructive">*</span>
          </Label>
          <Input
            value={contactData.lastName}
            onChange={(e) => setContactData(prev => ({ ...prev, lastName: e.target.value }))}
            placeholder="Шевченко"
            className={errors.lastName ? 'border-destructive' : ''}
          />
          {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
        </div>
      </div>

      <PhoneInput
        value={contactData.phone}
        onChange={(phone) => setContactData(prev => ({ ...prev, phone }))}
        error={errors.phone}
      />

      <Button onClick={handleNextFromContact} className="w-full">
        Продовжити
        <ChevronRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );

  // Render Delivery Step
  const renderDeliveryStep = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
        <Truck className="h-6 w-6 text-muted-foreground" />
        <div>
          <h3 className="font-medium text-foreground">Доставка</h3>
          <p className="text-xs text-muted-foreground">Оберіть службу та спосіб отримання</p>
        </div>
      </div>

      {/* Saved addresses quick select */}
      {savedAddresses.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Збережені адреси
          </Label>
          <div className="space-y-2">
            {savedAddresses.map((addr) => (
              <button
                key={addr.id}
                type="button"
                onClick={() => handleSelectSavedAddress(addr.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                  selectedSavedAddressId === addr.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-primary">
                      {addr.delivery_service === 'nova_poshta' ? 'Нова Пошта' : addr.delivery_service}
                    </span>
                    {addr.is_default && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Основна</span>
                    )}
                  </div>
                  <p className="text-sm text-foreground truncate">
                    {addr.city}
                    {addr.warehouse_number && `, Відділення №${addr.warehouse_number}`}
                  </p>
                  <p className="text-xs text-muted-foreground">{addr.recipient_name}</p>
                </div>
                {selectedSavedAddressId === addr.id && (
                  <Check className="h-5 w-5 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Multi-supplier auto-fulfillment warning */}
      {isMultiSupplier && deliveryData.deliveryType !== 'fulfillment' && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            ⚠️ Товари від {uniqueSuppliers.size} постачальників
          </p>
          <p className="text-xs text-muted-foreground">
            Обрано окрему доставку — кожна посилка оплачується окремо. 
            Рекомендуємо Фулфілмент НП для економії.
          </p>
          <button
            type="button"
            onClick={() => setDeliveryData(prev => ({ ...prev, service: 'nova_poshta', deliveryType: 'fulfillment' }))}
            className="text-xs font-medium text-primary hover:underline"
          >
            Обрати Фулфілмент НП →
          </button>
        </div>
      )}

      <DeliveryServiceSelect
        value={deliveryData.service}
        onChange={(service) => setDeliveryData(prev => ({ 
          ...prev, 
          service,
          warehouse: '',
          warehouseRef: '',
          pickupPoint: '',
        }))}
        deliveryType={deliveryData.deliveryType}
        onDeliveryTypeChange={(deliveryType) => setDeliveryData(prev => ({ 
          ...prev, 
          deliveryType,
          warehouse: '',
          warehouseRef: '',
        }))}
      />

      <DeliveryFields
        service={deliveryData.service}
        deliveryType={deliveryData.deliveryType}
        cityRef={deliveryData.cityRef}
        city={deliveryData.city}
        onCitySelect={(city) => {
          setDeliveryData(prev => ({
            ...prev,
            city: city.Description,
            cityRef: city.Ref,
            warehouse: '',
            warehouseRef: '',
          }));
        }}
        warehouseRef={deliveryData.warehouseRef}
        warehouseNumber={deliveryData.warehouse}
        onWarehouseSelect={(warehouse) => {
          setDeliveryData(prev => ({
            ...prev,
            warehouse: warehouse.Number,
            warehouseRef: warehouse.Ref,
          }));
        }}
        postalCode={deliveryData.postalCode}
        onPostalCodeChange={(code) => setDeliveryData(prev => ({ ...prev, postalCode: code }))}
        pickupPoint={deliveryData.pickupPoint}
        onPickupPointChange={(point) => setDeliveryData(prev => ({ ...prev, pickupPoint: point }))}
        courierAddress={deliveryData.courierAddress}
        onCourierAddressChange={(addr) => setDeliveryData(prev => ({ ...prev, courierAddress: addr }))}
        errors={errors}
      />

      {/* Delivery Estimate */}
      {deliveryData.cityRef && (
        <DeliveryEstimate
          service={deliveryData.service}
          type={deliveryData.deliveryType === 'warehouse' ? 'branch' : deliveryData.deliveryType === 'postomat' ? 'postomat' : deliveryData.deliveryType}
          city={deliveryData.city}
        />
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => goToStep('contact')} className="flex-1">
          Назад
        </Button>
        <Button onClick={handleNextFromDelivery} className="flex-1">
          Продовжити
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  // Render Payment Step
  const renderPaymentStep = () => (
    <div className="space-y-4">
      <PaymentMethodSelect
        value={paymentMethod}
        onChange={setPaymentMethod}
        paymentType={paymentType}
        onPaymentTypeChange={setPaymentType}
        allowTavernaBalance={["supplier", "shop_manager", "admin", "moderator"].includes(effectiveRole)}
      />

      {/* Discounts & Bonuses Section */}
      <CheckoutDiscounts
        subtotal={subtotal}
        bonusBalance={bonusBalance}
        bonusesToUse={bonusesToUse}
        onBonusesChange={setBonusesToUse}
        promoCode={promoCode}
        promoDiscount={promoDiscount}
        promoApplied={promoApplied}
        onPromoCodeChange={setPromoCode}
        onApplyPromo={handleApplyPromo}
        onRemovePromo={handleRemovePromo}
        personalBonuses={personalBonuses}
        selectedPersonalBonus={selectedPersonalBonus}
        onSelectPersonalBonus={setSelectedPersonalBonus}
        isAuthenticated={isAuthenticated}
        orderCount={orderCount}
      />

      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">Коментар до замовлення</Label>
        <textarea
          value={orderNotes}
          onChange={(e) => setOrderNotes(e.target.value)}
          placeholder="Додаткові побажання..."
          className="w-full h-20 p-3 rounded-lg border border-border bg-background text-sm resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
        />
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={() => goToStep('delivery')} className="flex-1">
          Назад
        </Button>
        <Button onClick={handleNextFromPayment} className="flex-1">
          Продовжити
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );

  // Render Confirm Step
  const renderConfirmStep = () => (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Check className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Перевірте замовлення</h3>
          <p className="text-xs text-muted-foreground">Переконайтесь, що все вірно</p>
        </div>
      </div>

      <OrderSummary
        items={items}
        subtotal={subtotal}
        deliveryCost={deliveryCost}
        total={total}
        promoDiscount={promoDiscount}
        bonusesUsed={bonusesToUse}
        personalBonusDiscount={personalBonusDiscount}
        personalBonusName={selectedPersonalBonus?.title}
        promoCode={promoApplied ? promoCode : undefined}
        paymentType={paymentType}
        amountToPayNow={amountToPayNow}
      />

      {/* Contact Info */}
      <div className="bg-muted/50 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <User className="h-4 w-4" />
          Одержувач
        </div>
        <p className="text-sm text-muted-foreground">
          {contactData.firstName} {contactData.lastName}
        </p>
        <p className="text-sm text-muted-foreground">+{contactData.phone}</p>
      </div>

      {/* Delivery Info */}
      <div className="bg-muted/50 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Truck className="h-4 w-4" />
          Доставка
          {deliveryData.deliveryType === 'fulfillment' && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Фулфілмент НП</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {deliveryData.city}{deliveryData.warehouse ? `, Відділення №${deliveryData.warehouse}` : ''}
        </p>
        {isMultiSupplier && deliveryData.deliveryType === 'fulfillment' && (
          <p className="text-xs text-primary">
            Товари від {uniqueSuppliers.size} постачальників будуть зібрані на складі НП в одну посилку
          </p>
        )}
      </div>

      {/* Payment Info */}
      <div className="bg-muted/50 rounded-xl p-4 space-y-2">
        <div className="text-sm font-medium text-foreground flex items-center gap-2">
          💳 Оплата
        </div>
        <p className="text-sm text-foreground font-medium">
          {paymentType === 'full_prepayment' && 'Повна оплата'}
          {paymentType === 'markup_only' && 'Часткова оплата (Лише націнка)'}
          {paymentType === 'cod' && 'При отриманні (Накладений платіж)'}
        </p>
        <p className="text-sm text-muted-foreground">
          {paymentMethod === 'cash' && 'Оплата при отриманні на пошті'}
          {paymentMethod === 'card' && 'Картка Visa/Mastercard'}
          {paymentMethod === 'mono' && 'MonoPay'}
          {paymentMethod === 'applepay' && 'Apple Pay'}
          {paymentMethod === 'googlepay' && 'Google Pay'}
          {paymentMethod === 'telegram_wallet' && 'Telegram Wallet'}
          {paymentMethod === 'taverna_balance' && 'Рахунок Taverna (баланс + бонуси)'}
        </p>
        {paymentType === 'markup_only' && (
          <p className="text-xs text-primary">
            Решту {Math.max(0, total - amountToPayNow).toLocaleString()}₴ сплатите при отриманні накладним платежем
          </p>
        )}
      </div>

      {/* Total highlight */}
      <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
        <span className="font-semibold text-foreground">Сума до сплати зараз:</span>
        <span className="text-xl font-bold text-primary">{amountToPayNow.toLocaleString()}₴</span>
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => goToStep('payment')}
          className="flex-1"
          disabled={isSubmitting}
        >
          Назад
        </Button>
        <Button
          onClick={handleSubmitOrder}
          className="flex-1 h-12 text-base font-semibold"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Обробка...
            </>
          ) : (
            <>
              Підтвердити замовлення
              <Check className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 animate-fade-in" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 bg-background rounded-t-3xl max-h-[90vh] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <ShoppingBag className="h-6 w-6 text-primary" />
            <div>
              <h2 className="font-bold text-lg text-foreground">
                {isAuthenticated ? 'Оформлення' : 'Оформлення (Гість)'}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
          >
            <X className="h-5 w-5 text-foreground" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="p-4 border-b border-border">
          <CheckoutSteps currentStep={currentStep} completedSteps={completedSteps} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {walletOrder ? (
            <WalletPayment
              orderId={walletOrder.id}
              orderNumber={walletOrder.number}
              amount={amountToPayNow}
              sessionToken={sessionToken}
              onPaid={(id) => { setWalletOrder(null); onOrderComplete(id); }}
              onCancel={() => { const id = walletOrder.id; setWalletOrder(null); onOrderComplete(id); }}
            />
          ) : (
            <>
              {currentStep === 'contact' && renderContactStep()}
              {currentStep === 'delivery' && renderDeliveryStep()}
              {currentStep === 'payment' && renderPaymentStep()}
              {currentStep === 'confirm' && renderConfirmStep()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
