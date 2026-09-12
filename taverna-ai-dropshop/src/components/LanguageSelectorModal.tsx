import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Check } from "lucide-react";

const languages = [
  { code: "uk", label: "Українська", flag: "🇺🇦" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
];

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LanguageSelectorModal({ isOpen, onClose }: LanguageSelectorModalProps) {
  const [selected, setSelected] = useState(() => localStorage.getItem("app-language") || "uk");

  useEffect(() => {
    setSelected(localStorage.getItem("app-language") || "uk");
  }, [isOpen]);

  const handleSelect = (code: string) => {
    setSelected(code);
    localStorage.setItem("app-language", code);
    const lang = languages.find((l) => l.code === code);
    toast({ title: "Мову змінено", description: `${lang?.flag} ${lang?.label}` });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-center">🌐 Мова додатку</DialogTitle>
        </DialogHeader>
        <RadioGroup value={selected} onValueChange={handleSelect} className="gap-0">
          {languages.map((lang) => (
            <label
              key={lang.code}
              className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer hover:bg-muted transition-colors"
            >
              <span className="text-xl">{lang.flag}</span>
              <span className="flex-1 font-medium text-sm">{lang.label}</span>
              <RadioGroupItem value={lang.code} className="sr-only" />
              {selected === lang.code && <Check className="h-4 w-4 text-primary" />}
            </label>
          ))}
        </RadioGroup>
      </DialogContent>
    </Dialog>
  );
}
