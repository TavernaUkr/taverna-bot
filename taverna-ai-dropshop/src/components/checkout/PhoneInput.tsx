import { useState, useEffect, ChangeEvent, FocusEvent, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  UA_PHONE_PREFIX,
  applyUaPhoneMask,
  blocksPrefixDeletion,
  insertUaPrefixOnFocus,
  isValidUaPhone,
} from "@/lib/uaValidation";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
  required?: boolean;
}

export const PhoneInput = ({
  value,
  onChange,
  error,
  label = "Телефон",
  required = true,
}: PhoneInputProps) => {
  const [displayValue, setDisplayValue] = useState("");

  // Форматує +380XXXXXXXXX у вигляді +380 (XX) XXX-XX-XX
  const formatPhone = (phone: string): string => {
    if (!phone) return "";
    const masked = applyUaPhoneMask(phone);
    if (!masked) return "";
    const digits = masked.replace(/\D/g, "").slice(0, 12); // 380 + 9 цифр
    return `+${digits.slice(0, 3)} (${digits.slice(3, 5)}) ${digits.slice(5, 8)}-${digits.slice(8, 10)}-${digits.slice(10, 12)}`;
  };

  useEffect(() => {
    // Нормалізуємо legacy-телефони (380XXXXXXXXX без "+") до +380XXXXXXXXX
    if (value && !value.startsWith("+")) {
      const normalized = applyUaPhoneMask(value);
      setDisplayValue(formatPhone(normalized));
      onChange(normalized);
      return;
    }
    setDisplayValue(value ? formatPhone(value) : "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const masked = applyUaPhoneMask(e.target.value);
    setDisplayValue(formatPhone(masked));
    onChange(masked);
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    if (!e.currentTarget.value.trim()) {
      insertUaPrefixOnFocus(e, (v) => {
        setDisplayValue(v);
        onChange(v);
      }, UA_PHONE_PREFIX);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (blocksPrefixDeletion(e, UA_PHONE_PREFIX)) e.preventDefault();
  };

  const isValid = isValidUaPhone(value);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        type="tel"
        inputMode="tel"
        maxLength={19}
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="+380 (XX) XXX-XX-XX"
        className={`${error || (!isValid && value.length > 4) ? "border-destructive" : ""}`}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && !isValid && value.length > 4 && (
        <p className="text-xs text-muted-foreground">
          Введіть повний номер: +380, код оператора та 7 цифр
        </p>
      )}
    </div>
  );
};
