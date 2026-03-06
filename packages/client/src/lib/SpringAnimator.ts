/**
 * Spring physics — the motion layer of GenomeHub's data visualization engine.
 *
 * Canvas for the data, DOM for the interface.
 * Canvas is for things you cannot touch.
 *
 * All springs subscribe to the global AnimationTicker — one rAF loop
 * for the entire application. When everything settles, the clock sleeps.
 *
 * SpringAnimator: drives 64-bin Float64Array positions, flushing to a
 * paint callback each frame. General-purpose — histograms are the first
 * visualization built on this, not the last.
 *
 * SingleSpring: drives a single scalar value via a write callback. Same
 * constants, same Euler-step math. Used by RiverGauge for clip-path animation.
 */

import { ticker } from './AnimationTicker';

const TENSION = 180;
const FRICTION = 12;
const MASS = 1;
const VELOCITY_EPSILON = 0.0005;
const POSITION_EPSILON = 0.0008;
const MAX_DT = 0.064; // cap at ~4 frames

/* ── SingleSpring — one value, callback-driven ── */

export class SingleSpring {
  private writeFn: (value: number) => void;
  private position = 0;
  private velocity = 0;
  private target = 0;
  private lastTime = 0;
  private disposed = false;
  private hasRun = false;
  private boundTick: (now: number) => boolean;

  constructor(writeFn: (value: number) => void) {
    this.writeFn = writeFn;
    this.boundTick = (now) => this.tick(now);
  }

  /** Retarget the spring. First call snaps; subsequent calls animate. */
  setTarget(value: number): void {
    this.target = value;
    if (!this.hasRun) {
      this.hasRun = true;
      this.position = value;
      this.velocity = 0;
      this.writeFn(value);
      return;
    }
    if (!this.disposed) {
      this.lastTime = 0; // prevent stale dt explosion on wake
      ticker.subscribe(this.boundTick);
    }
  }

  /** Immediate jump — stop animating, set position, call writeFn once. */
  snap(value: number): void {
    this.position = value;
    this.velocity = 0;
    this.target = value;
    ticker.unsubscribe(this.boundTick);
    this.writeFn(value);
  }

  dispose(): void {
    this.disposed = true;
    ticker.unsubscribe(this.boundTick);
  }

  private tick(now: number): boolean {
    if (this.disposed) return false;

    // First frame after wake: anchor timestamp, flush position, skip physics
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.writeFn(this.position);
      return true;
    }

    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    const displacement = this.target - this.position;
    const acceleration = (TENSION * displacement - FRICTION * this.velocity) / MASS;
    this.velocity += acceleration * dt;
    this.position += this.velocity * dt;

    if (Math.abs(this.velocity) < VELOCITY_EPSILON && Math.abs(displacement) < POSITION_EPSILON) {
      this.position = this.target;
      this.velocity = 0;
    }

    this.writeFn(this.position);

    // Settled — auto-unsubscribe from ticker
    return !(this.position === this.target && this.velocity === 0);
  }
}

/* ── SpringAnimator — 64-bin histogram bars ── */

export class SpringAnimator {
  private onFlush: (positions: Float64Array) => void;
  private positions: Float64Array;
  private velocities: Float64Array;
  private targets: Float64Array;
  private lastTime = 0;
  private disposed = false;
  private hasRun = false;
  private boundTick: (now: number) => boolean;

  constructor(onFlush: (positions: Float64Array) => void) {
    this.onFlush = onFlush;
    this.positions = new Float64Array(64);
    this.velocities = new Float64Array(64);
    this.targets = new Float64Array(64);
    this.boundTick = (now) => this.tick(now);
  }

  /** Normalize bins and retarget the spring. Subscribes to the global ticker. */
  setTargets(bins: number[]): void {
    // Normalize: find max, divide
    let mx = 0;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] > mx) mx = bins[i];
    }
    if (mx === 0) mx = 1;
    for (let i = 0; i < 64; i++) {
      this.targets[i] = (bins[i] ?? 0) / mx;
    }
    // First call: snap positions to targets so we don't spring from 0.
    // Subsequent calls spring from current positions.
    if (!this.hasRun) {
      this.hasRun = true;
      for (let i = 0; i < 64; i++) {
        this.positions[i] = this.targets[i];
      }
      this.flush();
      return;
    }
    if (!this.disposed) {
      this.lastTime = 0; // prevent stale dt explosion on wake
      ticker.subscribe(this.boundTick);
    }
  }

  dispose(): void {
    this.disposed = true;
    ticker.unsubscribe(this.boundTick);
  }

  private tick(now: number): boolean {
    if (this.disposed) return false;

    // First frame after wake: anchor timestamp, flush positions, skip physics
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.flush();
      return true;
    }

    const dt = Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    let allSettled = true;

    for (let i = 0; i < 64; i++) {
      const target = this.targets[i];
      let pos = this.positions[i];
      let vel = this.velocities[i];

      const displacement = target - pos;
      const acceleration = (TENSION * displacement - FRICTION * vel) / MASS;
      vel += acceleration * dt;
      pos += vel * dt;

      // Settled check
      if (Math.abs(vel) < VELOCITY_EPSILON && Math.abs(displacement) < POSITION_EPSILON) {
        pos = target;
        vel = 0;
      } else {
        allSettled = false;
      }

      this.positions[i] = pos;
      this.velocities[i] = vel;
    }

    this.flush();

    return !allSettled; // true = keep ticking, false = settled
  }

  private flush(): void {
    this.onFlush(this.positions);
  }
}
