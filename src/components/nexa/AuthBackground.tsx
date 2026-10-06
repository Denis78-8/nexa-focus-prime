/**
 * Quiet backdrop for the sign-in screen: a near-black graphite field with a
 * few soft, slowly drifting warm light zones, faint grain and a handful of
 * barely visible particles. It is opaque, so the app-wide ribbon background
 * does not show through here. Pure CSS ("Auth background" in styles.css);
 * motion stops under prefers-reduced-motion and the Settings animation switch.
 */
const PARTICLES = [
  { left: "12%", top: "22%", size: 2, delay: "-4s", duration: "46s" },
  { left: "84%", top: "18%", size: 1.5, delay: "-19s", duration: "58s" },
  { left: "71%", top: "76%", size: 2, delay: "-31s", duration: "52s" },
  { left: "23%", top: "81%", size: 1.5, delay: "-12s", duration: "64s" },
  { left: "91%", top: "52%", size: 1, delay: "-27s", duration: "49s" },
  { left: "6%", top: "58%", size: 1, delay: "-8s", duration: "61s" },
];

export function AuthBackground() {
  return (
    <div aria-hidden className="auth-bg">
      <div className="auth-bg__glow auth-bg__glow--warm" />
      <div className="auth-bg__glow auth-bg__glow--ember" />
      <div className="auth-bg__glow auth-bg__glow--cool" />
      <div className="auth-bg__calm" />
      <div className="auth-bg__grain" />
      {PARTICLES.map((particle) => (
        <span
          key={`${particle.left}-${particle.top}`}
          className="auth-bg__particle"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            animationDelay: particle.delay,
            animationDuration: particle.duration,
          }}
        />
      ))}
    </div>
  );
}
