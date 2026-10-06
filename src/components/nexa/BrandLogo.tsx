// The original LUNO DIGITAL artwork, shown unmodified and without any effects.
// public/luno-digital-logo.png is the supplied PNG with only its empty
// transparent margins trimmed (1655×676, transparent background).
const LOGO_SRC = "/luno-digital-logo.png";
const LOGO_WIDTH = 1655;
const LOGO_HEIGHT = 676;

export function BrandLogo({ height, className = "" }: { height: number; className?: string }) {
  const width = Math.round((height * LOGO_WIDTH) / LOGO_HEIGHT);
  return (
    <img
      src={LOGO_SRC}
      alt="LUNO DIGITAL"
      width={width}
      height={height}
      className={`shrink-0 select-none ${className}`}
      style={{ width, height }}
      draggable={false}
    />
  );
}
