import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Building, User, Mail, Phone, FileText, Globe, ChevronRight, Send, Loader2, CheckCircle, AlertCircle, LogIn, Landmark } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { Button } from "@/components/ui/button";

type SupplierType = "individual" | "company";

// Zod schema for robust validation
const supplierSchema = z.object({
  fullName: z.string()
    .min(5, "ПІБ має містити мінімум 5 символів")
    .max(100, "ПІБ не може перевищувати 100 символів")
    .regex(/^[а-яА-ЯіІїЇєЄґҐa-zA-Z\s'-]+$/, "ПІБ може містити лише літери"),
  companyName: z.string().optional(),
  taxId: z.string()
    .min(8, "ЄДРПОУ має містити 8 цифр")
    .max(8, "ЄДРПОУ має містити 8 цифр")
    .regex(/^\d{8}$/, "ЄДРПОУ має містити рівно 8 цифр"),
  email: z.string()
    .min(1, "Обов'язкове поле")
    .email("Невірний формат email")
    .max(255, "Email занадто довгий"),
  phone: z.string()
    .min(1, "Обов'язкове поле")
    .regex(/^\+?[\d\s()-]{10,20}$/, "Невірний формат телефону"),
  shopName: z.string()
    .min(2, "Назва магазину має містити мінімум 2 символи")
    .max(100, "Назва магазину не може перевищувати 100 символів"),
  xmlUrl: z.string().url("Невірний формат URL").optional().or(z.literal('')),
  telegramChannel: z.string().optional(),
  telegram: z.string().optional(),
  description: z.string().max(1000, "Опис не може перевищувати 1000 символів").optional(),
  paymentIban: z.string()
    .min(1, "IBAN обов'язковий для отримання виплат")
    .regex(/^UA\d{27}$/, "IBAN має бути у форматі UA + 27 цифр")
    .max(29, "IBAN має містити 29 символів"),
  paymentCardHolder: z.string()
    .min(3, "Вкажіть ПІБ власника рахунку")
    .max(100, "ПІБ занадто довге"),
  paymentBankName: z.string().optional(),
  agreeToTerms: z.literal(true, { errorMap: () => ({ message: "Необхідно прийняти умови" }) }),
});

type SupplierFormData = z.infer<typeof supplierSchema>;

const SupplierRegistration = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, profile, sessionToken, authenticate } = useTelegramAuth();
  const [step, setStep] = useState(1);
  const [supplierType, setSupplierType] = useState<SupplierType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  
  const { register, handleSubmit, trigger, formState: { errors }, setValue, getValues } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    mode: "onBlur",
    defaultValues: {
      fullName: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '',
      email: profile?.email || '',
      phone: profile?.phone || '',
      telegram: profile?.telegram_username || '',
    }
  });

  // Pre-fill form when profile loads
  useEffect(() => {
    if (profile) {
      setValue('fullName', `${profile.first_name || ''} ${profile.last_name || ''}`.trim());
      if (profile.email) setValue('email', profile.email);
      if (profile.phone) setValue('phone', profile.phone);
      if (profile.telegram_username) setValue('telegram', profile.telegram_username);
    }
  }, [profile, setValue]);
  
  const onSubmit = async (data: SupplierFormData) => {
    setIsSubmitting(true);
    setSubmitStatus('idle');
    
    try {
      // Get Telegram user data if available
      const telegramId = profile?.telegram_id || 
        (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id;

      const managerTelegram = (getValues as any)('managerTelegram') || '';
      const applicationData = {
        supplier_type: supplierType,
        full_name: data.fullName,
        company_name: data.companyName,
        tax_id: data.taxId,
        email: data.email,
        phone: data.phone,
        telegram_username: data.telegram,
        shop_name: data.shopName,
        xml_url: data.xmlUrl,
        telegram_channel: data.telegramChannel,
        description: data.description,
        telegram_id: telegramId,
        manager_telegram: managerTelegram,
        payment_iban: data.paymentIban,
        payment_card_holder: data.paymentCardHolder,
        payment_bank_name: data.paymentBankName || null,
      };

      const { data: result, error } = await supabase.functions.invoke('process-supplier-application', {
        body: {
          action: 'submit',
          application: applicationData,
          session_token: sessionToken,
        },
      });

      if (error) {
        throw new Error(error.message || 'Помилка при відправці заявки');
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Не вдалось відправити заявку');
      }

      setSubmitStatus('success');
      toast.success('Заявку успішно надіслано!', {
        description: 'Ми перевіримо вашу заявку та зв\'яжемось з вами найближчим часом.',
      });

      // Redirect after delay
      setTimeout(() => {
        navigate('/');
      }, 3000);

    } catch (error) {
      console.error('Submit error:', error);
      setSubmitStatus('error');
      toast.error('Помилка відправки', {
        description: error instanceof Error ? error.message : 'Спробуйте пізніше',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success screen
  if (submitStatus === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4 animate-fade-in">
          <div className="w-20 h-20 mx-auto rounded-full bg-success/20 flex items-center justify-center">
            <CheckCircle className="h-10 w-10 text-success" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Заявку надіслано!</h2>
          <p className="text-muted-foreground max-w-xs mx-auto">
            Наш менеджер перевірить вашу заявку та зв'яжеться з вами через Telegram.
          </p>
          <p className="text-xs text-muted-foreground">
            Ви отримаєте сповіщення про статус заявки
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-xl font-medium"
          >
            На головну
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Завантаження...</p>
        </div>
      </div>
    );
  }

  // Authorization required screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border">
          <div className="flex items-center h-14 px-4">
            <button 
              onClick={() => navigate("/?tab=account")}
              className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mr-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="font-semibold text-foreground">Стати партнером Taverna Group</h1>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-6 max-w-sm mx-auto animate-fade-in">
            <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <LogIn className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-foreground">Потрібна авторизація</h2>
              <p className="text-muted-foreground">
                Для подачі заявки на партнерство спочатку авторизуйтеся через Telegram
              </p>
            </div>
            
            <Button
              onClick={authenticate}
              size="lg"
              className="w-full gap-2"
            >
              <Send className="h-5 w-5" />
              Авторизуватись через Telegram
            </Button>
            
            <p className="text-xs text-muted-foreground">
              Це безпечно. Ми отримаємо лише ваше ім'я та ID для ідентифікації заявки.
            </p>
            
            <button
              onClick={() => navigate('/')}
              className="text-sm text-primary hover:underline"
            >
              Повернутись на головну
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border">
        <div className="flex items-center h-14 px-4">
          <button 
            onClick={() => step > 1 ? setStep(step - 1) : navigate(-1)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mr-2"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-semibold text-foreground">Стати партнером Taverna Group</h1>
        </div>
      </header>

      <main className="px-4 py-6 pb-24">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step indicator */}
        <div className="text-xs text-muted-foreground mb-4">
          Крок {step} з 3
        </div>

        {/* Step 1: Choose Type */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Тип партнера</h2>
              <p className="text-sm text-muted-foreground">
                Оберіть, як ви будете працювати з Taverna Group
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  setSupplierType("individual");
                  setStep(2);
                }}
                className="w-full flex items-center gap-4 p-4 bg-card rounded-xl border border-border hover:border-primary hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-foreground">Фізична особа</h3>
                  <p className="text-sm text-muted-foreground">ФОП або самозайнята особа</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>

              <button
                onClick={() => {
                  setSupplierType("company");
                  setStep(2);
                }}
                className="w-full flex items-center gap-4 p-4 bg-card rounded-xl border border-border hover:border-primary hover:shadow-md transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center group-hover:bg-accent/30 transition-colors">
                  <Building className="h-6 w-6 text-accent" />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-foreground">Юридична особа</h3>
                  <p className="text-sm text-muted-foreground">ТОВ, ПП або інша організація</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            <div className="p-4 bg-muted rounded-xl">
              <p className="text-xs text-muted-foreground">
                <strong>Важливо:</strong> Відповідно до законодавства України, для продажу товарів необхідна реєстрація ФОП (2 група) або юридичної особи.
              </p>
            </div>

            {/* Benefits */}
            <div className="space-y-3">
              <h3 className="font-medium text-foreground">Переваги партнерства:</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>Автоматичний імпорт товарів з XML/MyDrop</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>AI-генерація описів для маркетплейсів</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>Просування в Telegram-каналі @taverna_ukr_group</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>Панель управління замовленнями</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Step 2: Contact Info */}
        {step === 2 && (
          <form className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Контактні дані</h2>
              <p className="text-sm text-muted-foreground">
                {supplierType === "individual" ? "Дані фізичної особи-підприємця" : "Дані вашої компанії"}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  ПІБ {supplierType === "company" && "контактної особи"} *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    {...register("fullName", { required: "Обов'язкове поле" })}
                    type="text"
                    placeholder="Іваненко Іван Іванович"
                    className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {errors.fullName && (
                  <p className="text-xs text-destructive">{errors.fullName.message}</p>
                )}
              </div>

              {supplierType === "company" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Назва компанії *</label>
                  <div className="relative">
                    <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input
                      {...register("companyName", { required: supplierType === "company" ? "Обов'язкове поле" : false })}
                      type="text"
                      placeholder="ТОВ 'Назва компанії'"
                      className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  {errors.companyName && (
                    <p className="text-xs text-destructive">{errors.companyName.message}</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Код ЄДРПОУ (8 цифр) *
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    {...register("taxId")}
                    type="text"
                    maxLength={8}
                    placeholder="12345678"
                    className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    onChange={(e) => {
                      // Allow only digits
                      const value = e.target.value.replace(/\D/g, '');
                      e.target.value = value;
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {supplierType === "individual" 
                    ? "Для ФОП використовуйте ЄДРПОУ як юридична категорія платника податків" 
                    : "Код компанії з Єдиного державного реєстру"}
                </p>
                {errors.taxId && (
                  <p className="text-xs text-destructive">{errors.taxId.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email *</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    {...register("email")}
                    type="email"
                    placeholder="partner@example.com"
                    className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Телефон *</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    {...register("phone")}
                    type="tel"
                    placeholder="+380 XX XXX XX XX"
                    className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                {errors.phone && (
                  <p className="text-xs text-destructive">{errors.phone.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Telegram для зв'язку</label>
                <input
                  {...register("telegram")}
                  type="text"
                  placeholder="@your_telegram"
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Telegram менеджера магазину</label>
                <input
                  {...register("managerTelegram" as any)}
                  type="text"
                  placeholder="@manager_username"
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Менеджер отримуватиме сповіщення від бота при зверненнях клієнтів
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors"
              >
                Назад
              </button>
              <button
                type="button"
                onClick={async () => {
                  // Validate step 2 fields before proceeding
                  const fieldsToValidate: Array<keyof SupplierFormData> = ['fullName', 'taxId', 'email', 'phone'];
                  if (supplierType === 'company') {
                    fieldsToValidate.push('companyName');
                  }
                  const isValid = await trigger(fieldsToValidate);
                  if (isValid) {
                    setStep(3);
                  } else {
                    toast.error('Виправте помилки у формі', {
                      description: 'Перевірте правильність заповнення всіх обов\'язкових полів',
                    });
                  }
                }}
                className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors"
              >
                Далі
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Shop Info */}
        {step === 3 && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-xl font-bold text-foreground mb-2">Інформація про магазин</h2>
              <p className="text-sm text-muted-foreground">
                Розкажіть про ваш дроп-магазин
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Назва магазину в Taverna *</label>
                <input
                  {...register("shopName", { required: "Обов'язкове поле" })}
                  type="text"
                  placeholder="Мій крутий магазин"
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {errors.shopName && (
                  <p className="text-xs text-destructive">{errors.shopName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Посилання на XML-фід (MyDrop, Prom, тощо)
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <input
                    {...register("xmlUrl")}
                    type="url"
                    placeholder="https://mydrop.com.ua/export/..."
                    className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  AI автоматично проаналізує ваші товари, категорії та ціни
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Telegram-канал з товарами (якщо є)
                </label>
                <input
                  {...register("telegramChannel")}
                  type="text"
                  placeholder="@your_shop_channel"
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Опис вашого магазину</label>
                <textarea
                  {...register("description")}
                  rows={4}
                  placeholder="Розкажіть про асортимент, переваги, досвід роботи..."
                  className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              {/* Payment Details Section */}
              <div className="p-4 bg-accent/10 border border-accent/20 rounded-xl space-y-4">
                <h4 className="font-medium text-foreground flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-accent" />
                  Реквізити для виплат
                </h4>
                <p className="text-xs text-muted-foreground">
                  Для автоматичного переказу дроп-ціни при повній предоплаті клієнтом
                </p>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">IBAN рахунок *</label>
                  <div className="relative">
                    <Landmark className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input
                      {...register("paymentIban")}
                      type="text"
                      maxLength={29}
                      placeholder="UA123456789012345678901234567"
                      className="w-full pl-10 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary uppercase"
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        setValue('paymentIban', val);
                      }}
                    />
                  </div>
                  {errors.paymentIban && (
                    <p className="text-xs text-destructive">{errors.paymentIban.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">ПІБ власника рахунку *</label>
                  <input
                    {...register("paymentCardHolder")}
                    type="text"
                    placeholder="Іваненко Іван Іванович"
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  {errors.paymentCardHolder && (
                    <p className="text-xs text-destructive">{errors.paymentCardHolder.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Назва банку</label>
                  <input
                    {...register("paymentBankName")}
                    type="text"
                    placeholder="Monobank / ПриватБанк / тощо"
                    className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 p-4 bg-muted rounded-xl cursor-pointer">
                <input
                  {...register("agreeToTerms", { required: "Необхідно прийняти умови" })}
                  type="checkbox"
                  className="mt-0.5 w-5 h-5 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-muted-foreground">
                  Я погоджуюся з <a href="#" className="text-primary underline">Умовами використання</a> та{" "}
                  <a href="#" className="text-primary underline">Політикою конфіденційності</a> Taverna Group
                </span>
              </label>
              {errors.agreeToTerms && (
                <p className="text-xs text-destructive">{errors.agreeToTerms.message}</p>
              )}
            </div>

            {/* AI Analysis Info */}
            <div className="p-4 bg-accent/10 border border-accent/20 rounded-xl space-y-2">
              <h4 className="font-medium text-foreground flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-accent" />
                Що відбудеться після відправки?
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• AI проаналізує ваш XML-фід та товари</li>
                <li>• Перевіримо унікальність асортименту</li>
                <li>• Адміністратор отримає звіт у Telegram</li>
                <li>• Ви отримаєте сповіщення про рішення</li>
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isSubmitting}
                className="flex-1 py-3 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
              >
                Назад
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Надсилання...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Надіслати заявку
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
};

export default SupplierRegistration;
