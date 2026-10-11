import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle. Only the input type changes; the
 * value, validation attributes and form submission stay with the caller.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(
  ({ className, id, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          className={cn("pr-11", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,scale] duration-150 ease-(--ease-spring) hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 active:scale-90"
        >
          {/* Cross-fade between the two icons instead of an abrupt swap. */}
          <Eye
            className={cn(
              "absolute h-[18px] w-[18px] transition-[opacity,scale] duration-200 ease-(--ease-out-soft)",
              visible ? "scale-75 opacity-0" : "opacity-100",
            )}
          />
          <EyeOff
            className={cn(
              "absolute h-[18px] w-[18px] transition-[opacity,scale] duration-200 ease-(--ease-out-soft)",
              visible ? "opacity-100" : "scale-75 opacity-0",
            )}
          />
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
