// The original LUNO DIGITAL artwork, shown unmodified and without any effects.
// public/luno-digital-logo.png is the supplied PNG with only its empty
// transparent margins trimmed (1655×676, transparent background).
// public/luno-digital-logo-light.png is the same image for dark backgrounds:
// only the graphite letters "LUN" are recoloured (#F2F0EC, the brand kit's
// on-dark letter colour); the "O", its squares and "DIGITAL" are pixel-identical.
const LOGO_SRC = {
  original: "/luno-digital-logo.png",
  light: "/luno-digital-logo-light.png",
} as const;
const LOGO_WIDTH = 1655;
const LOGO_HEIGHT = 676;

export function BrandLogo({
  height,
  className = "",
  variant = "original",
}: {
  height: number;
  className?: string;
  variant?: keyof typeof LOGO_SRC;
}) {
  const width = Math.round((height * LOGO_WIDTH) / LOGO_HEIGHT);
  return (
    <img
      src={LOGO_SRC[variant]}
      alt="LUNO DIGITAL"
      width={width}
      height={height}
      className={`shrink-0 select-none ${className}`}
      style={{ width, height }}
      draggable={false}
    />
  );
}
