import { useEffect, useRef } from "react";
import { useRegisterBack } from "@/hooks/useAppBack";
import { getTelegramWebApp } from "@/hooks/useTelegramUI";

let nextModalId = 1;
let modalStack: number[] = [];

/**
 * Прив'язує Sheet/Dialog до window.history, щоб системна «Назад»
 * (Android, свайп iOS) закривала модалку, а не Mini App.
 */
export function useModalHistory(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const idRef = useRef(0);
  if (idRef.current === 0) {
    idRef.current = nextModalId++;
  }
  const id = idRef.current;

  const pushedRef = useRef(false);
  const closedByPopRef = useRef(false);

  useRegisterBack(isOpen, () => {
    onCloseRef.current();
  });

  useEffect(() => {
    if (isOpen) {
      if (!pushedRef.current) {
        window.history.pushState({ modal: true, id }, "");
        pushedRef.current = true;
        modalStack.push(id);
      }
      return;
    }

    if (!pushedRef.current) return;
    pushedRef.current = false;
    modalStack = modalStack.filter((item) => item !== id);
    if (!closedByPopRef.current) {
      window.history.back();
    }
    closedByPopRef.current = false;
  }, [id, isOpen]);

  useEffect(() => {
    const onPopState = () => {
      if (!pushedRef.current) return;
      if (modalStack[modalStack.length - 1] !== id) return;
      pushedRef.current = false;
      closedByPopRef.current = true;
      modalStack = modalStack.filter((item) => item !== id);
      onCloseRef.current();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [id]);

  useEffect(() => {
    return () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      modalStack = modalStack.filter((item) => item !== id);
      if (!closedByPopRef.current) {
        window.history.back();
      }
    };
  }, [id]);

  useEffect(() => {
    if (!isOpen) return;
    const backButton = getTelegramWebApp()?.BackButton;
    if (!backButton) return;

    const onBack = () => {
      onCloseRef.current();
    };

    backButton.show();
    backButton.onClick(onBack);
    return () => {
      backButton.offClick(onBack);
    };
  }, [isOpen]);
}
