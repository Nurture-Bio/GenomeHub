import type { Organism } from '../entities/index.js';

export function organismDisplay(o: Organism): string {
  return `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`;
}
