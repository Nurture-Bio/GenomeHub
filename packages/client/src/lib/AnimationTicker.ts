/**
 * AnimationTicker — the master clock for GenomeHub's data visualization engine.
 *
 * One main loop. Like a game engine.
 *
 * All spring physics, breathing animations, and future visualizations
 * subscribe here. Never create independent rAF loops for data viz.
 *
 * Subscribers provide (now: DOMHighResTimeStamp) => boolean.
 * Return true to keep ticking next frame, false to auto-unsubscribe.
 * When zero subscribers remain, the loop sleeps. Zero idle CPU.
 */

type TickFn = (now: number) => boolean;

class AnimationTicker {
  private subscribers = new Set<TickFn>();
  private rafId: number | null = null;

  /** Add a tick function. Starts the rAF loop if it was sleeping. */
  subscribe(fn: TickFn): void {
    this.subscribers.add(fn);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  /** Remove a tick function. The loop discovers emptiness naturally. */
  unsubscribe(fn: TickFn): void {
    this.subscribers.delete(fn);
  }

  private tick(now: number): void {
    for (const fn of this.subscribers) {
      try {
        if (!fn(now)) this.subscribers.delete(fn);
      } catch (e) {
        this.subscribers.delete(fn);
        console.error('AnimationTicker: subscriber threw, removed:', e);
      }
    }
    if (this.subscribers.size > 0) {
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    } else {
      this.rafId = null;
    }
  }
}

/** Singleton — the one true animation loop. */
export const ticker = new AnimationTicker();
