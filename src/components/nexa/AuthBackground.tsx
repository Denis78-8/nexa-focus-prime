import { LunoBackdrop } from "@/components/nexa/LunoBackdrop";

/**
 * Backdrop of the sign-in screens (/auth, /change-password, /owner-reset): the
 * expressive version of the LUNO eclipse — large, rising from behind the
 * sign-in panel, with the logo's pixel squares. Opaque, so the workspace
 * backdrop is not mounted on these routes (see __root.tsx).
 */
export function AuthBackground() {
  return (
    <div aria-hidden className="auth-bg">
      <LunoBackdrop variant="auth" />
    </div>
  );
}
