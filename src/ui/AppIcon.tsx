export function AppIcon({ src, size = 16 }: { src: string; size?: number }) {
  return <img className="app-icon" src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
