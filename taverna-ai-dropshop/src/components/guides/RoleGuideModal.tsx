import { ModeratorGuideModal } from "@/components/guides/ModeratorGuideModal";
import { ManagerGuideModal } from "@/components/guides/ManagerGuideModal";

type GuideRole = "moderator" | "manager";

interface RoleGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: GuideRole;
}

/** Залишено для сумісності: відкриває окремі рольові гіди. */
export function RoleGuideModal({ isOpen, onClose, role }: RoleGuideModalProps) {
  if (role === "moderator") {
    return <ModeratorGuideModal isOpen={isOpen} onClose={onClose} />;
  }
  return <ManagerGuideModal isOpen={isOpen} onClose={onClose} />;
}
