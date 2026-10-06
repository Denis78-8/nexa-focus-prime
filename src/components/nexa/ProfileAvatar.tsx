import { useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { uploadMyAvatar, useAvatarUrl, validateAvatarFile } from "@/lib/avatars";

/** A profile photo with an initials fallback; used wherever a person is shown. */
export function ProfileAvatar({
  avatarUrl,
  name,
  initials,
  className,
  fallbackClassName = "",
}: {
  avatarUrl: string | null | undefined;
  name: string;
  initials: string;
  className: string;
  fallbackClassName?: string;
}) {
  const src = useAvatarUrl(avatarUrl);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} className="object-cover" />}
      <AvatarFallback className={`rounded-[inherit] bg-secondary font-semibold text-foreground ${fallbackClassName}`}>{initials}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The signed-in user's own photo with an "Изменить фото" control:
 * pick a file → preview → save (upload to Storage + profiles.avatar_url).
 */
export function EditableProfileAvatar({
  avatarUrl,
  name,
  initials,
  onUploaded,
}: {
  avatarUrl: string | null | undefined;
  name: string;
  initials: string;
  onUploaded: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setPreview({ file, url: URL.createObjectURL(file) });
  };

  const save = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      await uploadMyAvatar(preview.file);
      await onUploaded();
      setPreview(null);
      toast.success("Фото профиля обновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить фото");
    } finally {
      setSaving(false);
    }
  };

  const choose = () => inputRef.current?.click();

  return (
    <MotionConfig reducedMotion="user">
    <div className="density-fixed flex shrink-0 flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <motion.div
          whileHover={{ scale: 1.01 }}
          transition={{ duration: 0.2 }}
          className="h-full w-full overflow-hidden rounded-xl border border-border bg-secondary"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={preview?.url ?? "current"} className="h-full w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {preview ? (
                <img src={preview.url} alt="Предпросмотр нового фото" className="h-full w-full object-cover" />
              ) : (
                <ProfileAvatar avatarUrl={avatarUrl} name={name} initials={initials} className="h-full w-full rounded-none" fallbackClassName="text-2xl tracking-tight" />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
        <motion.button
          type="button"
          onClick={choose}
          disabled={saving}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.96 }}
          transition={{ duration: 0.16 }}
          aria-label="Изменить фото профиля"
          title="Изменить фото"
          className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Camera className="h-3.5 w-3.5" />
        </motion.button>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      {/* Fixed-height slot, so switching to Save/Cancel does not change the hero height. */}
      <div className="flex h-7 items-center">
        <AnimatePresence mode="wait" initial={false}>
          {preview ? (
            <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="flex gap-1">
              <Button type="button" size="sm" className="h-7 px-2.5 text-xs" disabled={saving} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить"}</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={() => setPreview(null)}>Отмена</Button>
            </motion.div>
          ) : (
            <motion.button key="change" type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onClick={choose} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              Изменить фото
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
    </MotionConfig>
  );
}
