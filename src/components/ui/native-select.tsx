import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A native <select> styled like Input: keeps the platform picker (and empty
 * "no value" options, which Radix Select does not allow) with the LUNO field
 * look. `icon` adds a leading glyph; `wrapperClassName` sizes the control in
 * its layout.
 */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select"> & {
    icon?: React.ComponentType<{ className?: string }>;
    wrapperClassName?: string;
  }
>(({ className, wrapperClassName, icon: Icon, children, ...props }, ref) => (
  <span className={cn("relative block min-w-0", wrapperClassName)}>
    {Icon && (
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    )}
    <select
      ref={ref}
      className={cn(
        "h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-input bg-field pl-3 pr-9 text-sm text-foreground transition-[color,background-color,border-color,box-shadow] duration-150 ease-(--ease-out-soft) hover:border-border-strong focus-visible:border-primary/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50",
        Icon && "pl-9",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </span>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
