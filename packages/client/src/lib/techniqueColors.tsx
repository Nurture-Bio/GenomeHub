export function techniqueColor(name: string): { color: string; bg: string } {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = (hash * 33) ^ name.charCodeAt(i);
  const hue = ((hash >>> 0) % 360);
  return {
    color: `oklch(0.75 0.18 ${hue})`,
    bg: `oklch(0.20 0.04 ${hue})`,
  };
}

export function TechniquePill({ name }: { name: string }) {
  const { color, bg } = techniqueColor(name);
  return (
    <span className="font-mono text-micro px-1.5 py-0.5 rounded-sm inline-block"
      style={{ background: bg, color }}>{name}</span>
  );
}
