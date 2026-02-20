import { Badge } from '../ui';
import { hashColor } from './colors';

export function techniqueColor(name: string) {
  return hashColor(name);
}

export function TechniquePill({ name }: { name: string }) {
  const { color, bg } = hashColor(name);
  return (
    <Badge variant="status" style={{ background: bg, color }}>{name}</Badge>
  );
}
