import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The LUNO DIGITAL theme adds its own type scale, radii and shadow
// (styles.css). Without them tailwind-merge would read `text-title-3` as a
// colour and drop `text-foreground` (or keep two font sizes), so it is told
// which group each token belongs to.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display",
        "title-1",
        "title-2",
        "title-3",
        "body",
        "reading",
        "callout",
        "caption",
        "badge",
        "metric",
        "timer",
      ],
      radius: ["control", "card", "overlay"],
      shadow: ["raised"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
