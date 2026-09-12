import { useRef, useState } from "react";
import { Image as ImageIcon, Video, X, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  profileId?: string;
  images: string[];
  video: string | null;
  onChange: (next: { images: string[]; video: string | null }) => void;
  maxImages?: number;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

export function PostMediaUploader({
  profileId,
  images,
  video,
  onChange,
  maxImages = 5,
}: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadFile = async (file: File, kind: "image" | "video"): Promise<string | null> => {
    if (!profileId) {
      toast.error("Не вдалось визначити користувача");
      return null;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() || (kind === "image" ? "jpg" : "mp4");
    const path = `promotions/${profileId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("shop-assets").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
    if (error) {
      console.error("upload error", error);
      toast.error(`Помилка завантаження: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from("shop-assets").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleImagesPicked = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = maxImages - images.length;
    const valid = Array.from(files).slice(0, room).filter((f) => {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name}: не зображення`);
        return false;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        toast.error(`${f.name}: більше 5 МБ`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of valid) {
        const url = await uploadFile(f, "image");
        if (url) urls.push(url);
      }
      if (urls.length > 0) {
        onChange({ images: [...images, ...urls], video });
        toast.success(`Завантажено: ${urls.length}`);
      }
    } finally {
      setUploading(false);
      if (imageInput.current) imageInput.current.value = "";
    }
  };

  const handleVideoPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Не відео");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error("Відео більше 50 МБ");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file, "video");
      if (url) {
        onChange({ images, video: url });
        toast.success("Відео завантажено");
      }
    } finally {
      setUploading(false);
      if (videoInput.current) videoInput.current.value = "";
    }
  };

  const removeImage = (i: number) => {
    onChange({ images: images.filter((_, idx) => idx !== i), video });
  };

  const removeVideo = () => onChange({ images, video: null });

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-primary" />
        Медіа (фото / відео)
        <Badge variant="outline" className="text-[10px]">опційно</Badge>
      </Label>

      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={url} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group">
            <img src={url} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeImage(i)}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {video && (
          <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group bg-black">
            <video src={video} className="w-full h-full object-cover" muted />
            <Video className="absolute top-1 left-1 h-4 w-4 text-white drop-shadow" />
            <button
              type="button"
              onClick={removeVideo}
              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {images.length < maxImages && (
          <button
            type="button"
            onClick={() => imageInput.current?.click()}
            disabled={uploading}
            className={cn(
              "w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors",
              uploading && "opacity-50",
            )}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="text-[10px]">Фото</span>
          </button>
        )}

        {!video && (
          <button
            type="button"
            onClick={() => videoInput.current?.click()}
            disabled={uploading}
            className={cn(
              "w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors",
              uploading && "opacity-50",
            )}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            <span className="text-[10px]">Відео</span>
          </button>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        До {maxImages} фото (≤5 МБ) і 1 відео (≤50 МБ). Якщо не додати — буде використано фото товару.
      </p>

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => handleImagesPicked(e.target.files)}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => handleVideoPicked(e.target.files)}
      />
    </div>
  );
}
