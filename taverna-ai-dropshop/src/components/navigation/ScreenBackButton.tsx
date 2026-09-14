import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface ScreenBackButtonProps {
  onClick?: () => void;
  className?: string;
  label?: string;
}

/** Єдина кнопка «Назад» для повноекранних екранів Mini App. */
export function ScreenBackButton({ onClick, className, label }: ScreenBackButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  };

  return (
    <button
      type="button"
      aria-label={label || "Назад"}
      onClick={handleClick}
      className={cn(
        "w-11 h-11 shrink-0 rounded-xl flex items-center justify-center",
        "text-muted-foreground hover:text-foreground hover:bg-muted transition-all",
        className,
      )}
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
