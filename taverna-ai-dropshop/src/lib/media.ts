/**
 * Медіа товару з Telegram/Supabase може бути звичайним фото, гіфкою (.gif)
 * або відео-кружечком (.mp4/.webm). Гіфки рендеряться як звичайний <img>
 * (браузер сам їх анімує), а .mp4/.webm потребують тегу <video>, інакше
 * фронтенд намагається намалювати відеофайл через <img> і показує "биту"
 * картинку.
 */
export const isVideoUrl = (url?: string | null): boolean => {
  if (!url) return false;
  return /\.(mp4|webm)(\?.*)?$/i.test(url.trim());
};

/**
 * Прев'ю (напр. кружечок кольору) не можна будувати з відео — CSS/img не
 * вміє показати .mp4/.webm як картинку. Повертає перше НЕ-відео посилання
 * з масиву медіа товару, або "" якщо в товару є ТІЛЬКИ відео/нічого нема.
 */
export const firstPhotoUrl = (images?: (string | null | undefined)[] | null): string => {
  if (!images) return "";
  const photo = images.find((url) => !!url && !isVideoUrl(url));
  return photo || "";
};
