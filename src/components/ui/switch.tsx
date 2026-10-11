import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * LUNO switch, 24×40. The thumb travels on a spring and stretches while it is
 * pressed (towards the side it will move to), like the iOS switch.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "density-fixed group peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-[background-color,border-color,box-shadow] duration-300 ease-(--ease-out-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_14px_-2px_oklch(0.724_0.187_48.9/0.55)] data-[state=unchecked]:border-border-strong data-[state=unchecked]:bg-secondary",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_oklch(0_0_0/0.4),0_0_0_0.5px_oklch(0_0_0/0.15)] transition-[translate,width] duration-300 ease-(--ease-spring)",
        "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-4",
        "group-active:w-6 group-active:data-[state=checked]:translate-x-3",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
