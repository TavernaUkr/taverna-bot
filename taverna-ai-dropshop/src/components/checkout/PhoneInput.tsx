import { useState, useEffect, ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  // Format phone for display
  const formatPhone = (phone: string): string => {
    const digits = phone.replace(/\D/g, "").slice(0, 12);
    
    if (digits.length === 0) return "";
    if (digits.length <= 2) return `+${digits}`;
    if (digits.length <= 5) return `+${digits.slice(0, 2)} (${digits.slice(2)}`;
    if (digits.length <= 8) return `+${digits.slice(0, 2)} (${digits.slice(2, 5)}) ${digits.slice(5)}`;
    if (digits.length <= 10) return `+${digits.slice(0, 2)} (${digits.slice(2, 5)}) ${digits.slice(5, 8)}-${digits.slice(8)}`;
    return `+${digits.slice(0, 2)} (${digits.slice(2, 5)}) ${digits.slice(5, 8)}-${digits.slice(8, 10)}-${digits.slice(10, 12)}`;
  };

  // Parse phone to raw digits
  const parsePhone = (phone: string): string => {
    return phone.replace(/\D/g, "");
  };

  useEffect(() => {
    if (value) {
      setDisplayValue(formatPhone(value));
    } else {
      setDisplayValue("+380 ");
    }
  }, []);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    const digits = parsePhone(input);
    
    // Ensure it starts with 380
    let normalizedDigits = digits;
    if (!digits.startsWith("380")) {
      if (digits.startsWith("80")) {
        normalizedDigits = "3" + digits;
      } else if (digits.startsWith("0")) {
        normalizedDigits = "38" + digits;
      } else if (!digits.startsWith("3")) {
        normalizedDigits = "380" + digits;
      }
    }
    
    // Limit to 12 digits (380 + 9 digits)
    normalizedDigits = normalizedDigits.slice(0, 12);
    
    const formatted = formatPhone(normalizedDigits);
    setDisplayValue(formatted);
    onChange(normalizedDigits);
  };

  const handleFocus = () => {
    if (!displayValue || displayValue === "") {
      setDisplayValue("+380 ");
    }
  };

  const isValid = value.length === 12;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
        type="tel"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        placeholder="+380 (XX) XXX-XX-XX"
        className={`${error || (!isValid && value.length > 3) ? "border-destructive" : ""}`}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!isValid && value.length > 3 && value.length < 12 && (
        <p className="text-xs text-muted-foreground">
          Введіть повний номер телефону
        </p>
      )}
    </div>
  );
};
