import { useState, useEffect } from "react";
import { Camera, Save, Loader2, Store, FileText, Phone, Mail, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { triggerHapticFeedback } from "@/lib/haptics";

interface SupplierData {
  id: string;
  shop_name: string;
  description: string;
  logo_url: string;
  contact_phone: string;
  contact_email: string;
  website_url: string;
  telegram_channel: string;
}

interface SupplierSettingsProps {
  supplierId: string;
  onUpdate?: () => void;
}

export function SupplierSettings({ supplierId, onUpdate }: SupplierSettingsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<SupplierData>({
    id: "",
    shop_name: "",
    description: "",
    logo_url: "",
    contact_phone: "",
    contact_email: "",
    website_url: "",
    telegram_channel: "",
  });

  useEffect(() => {
    if (supplierId) {
      fetchSupplierData();
    }
  }, [supplierId]);

  const fetchSupplierData = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("id", supplierId)
        .single();

      if (error) throw error;

      setFormData({
        id: data.id,
        shop_name: data.shop_name || "",
        description: (data as any).description || "",
        logo_url: (data as any).logo_url || "",
        contact_phone: data.contact_phone || "",
        contact_email: data.contact_email || "",
        website_url: (data as any).website_url || "",
        telegram_channel: data.telegram_channel_url || "",
      });
    } catch (err) {
      console.error("Error fetching supplier:", err);
      toast.error("Помилка завантаження даних");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.shop_name.trim()) {
      toast.error("Назва магазину обов'язкова");
      return;
    }

    setIsSaving(true);
    triggerHapticFeedback("impact", "light");

    try {
      const { error } = await supabase
        .from("suppliers")
        .update({
          shop_name: formData.shop_name.trim(),
          description: formData.description.trim(),
          logo_url: formData.logo_url.trim(),
          contact_phone: formData.contact_phone.trim(),
          contact_email: formData.contact_email.trim(),
          website_url: formData.website_url.trim(),
          telegram_channel: formData.telegram_channel.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", supplierId);

      if (error) throw error;

      triggerHapticFeedback("notification", "success");
      toast.success("Налаштування збережено!");
      onUpdate?.();
    } catch (err) {
      console.error("Error saving supplier:", err);
      triggerHapticFeedback("notification", "error");
      toast.error("Помилка збереження");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof SupplierData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Logo & Shop Name Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            Профіль магазину
          </CardTitle>
          <CardDescription>
            Інформація, яку бачать покупці на вашій сторінці
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo Preview */}
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20 border-2 border-border">
              <AvatarImage src={formData.logo_url} alt={formData.shop_name} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {formData.shop_name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-2">
              <Label htmlFor="logo_url" className="text-sm text-muted-foreground flex items-center gap-1">
                <Camera className="h-4 w-4" />
                URL логотипу
              </Label>
              <Input
                id="logo_url"
                value={formData.logo_url}
                onChange={(e) => handleChange("logo_url", e.target.value)}
                placeholder="https://example.com/logo.png"
                className="h-10"
              />
            </div>
          </div>

          {/* Shop Name */}
          <div className="space-y-2">
            <Label htmlFor="shop_name" className="text-sm font-medium">
              Назва магазину *
            </Label>
            <Input
              id="shop_name"
              value={formData.shop_name}
              onChange={(e) => handleChange("shop_name", e.target.value)}
              placeholder="Мій магазин"
              className="h-12 text-lg"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-medium flex items-center gap-1">
              <FileText className="h-4 w-4" />
              Опис магазину
            </Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleChange("description", e.target.value)}
              placeholder="Розкажіть про свій магазин, асортимент, переваги..."
              rows={4}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Contact Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Контактна інформація
          </CardTitle>
          <CardDescription>
            Як покупці можуть зв'язатися з вами
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact_phone" className="text-sm font-medium">
                Телефон
              </Label>
              <Input
                id="contact_phone"
                value={formData.contact_phone}
                onChange={(e) => handleChange("contact_phone", e.target.value)}
                placeholder="+380..."
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_email" className="text-sm font-medium flex items-center gap-1">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                id="contact_email"
                type="email"
                value={formData.contact_email}
                onChange={(e) => handleChange("contact_email", e.target.value)}
                placeholder="shop@example.com"
                className="h-10"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="website_url" className="text-sm font-medium flex items-center gap-1">
                <Globe className="h-4 w-4" />
                Вебсайт
              </Label>
              <Input
                id="website_url"
                value={formData.website_url}
                onChange={(e) => handleChange("website_url", e.target.value)}
                placeholder="https://myshop.com"
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telegram_channel" className="text-sm font-medium">
                Telegram канал
              </Label>
              <Input
                id="telegram_channel"
                value={formData.telegram_channel}
                onChange={(e) => handleChange("telegram_channel", e.target.value)}
                placeholder="@myshop"
                className="h-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full h-12 text-base font-semibold"
      >
        {isSaving ? (
          <>
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Збереження...
          </>
        ) : (
          <>
            <Save className="h-5 w-5 mr-2" />
            Зберегти зміни
          </>
        )}
      </Button>
    </div>
  );
}
