/**
 * Spring physics — imperative underdamped springs for UI animation.
 *
 * Canvas for the data, DOM for the interface.
 * Canvas is for things you cannot touch.
 *
 * SpringAnimator: drives 64 histogram bar positions via a rAF loop,
 * flushing to a paint callback each frame (zero DOM / CSS var writes).
 * One canvas element replaces 128 SVG rects per slider.
 *
 * SingleSpring: drives a single value via a write callback. Same constants,
 * same Euler-step math. Used by RiverGauge for clip-path animation.
 */

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
  private rafId: number | null = null;
  private lastTime = 0;
  private disposed = false;
  private hasRun = false;

  constructor(writeFn: (value: number) => void) {
    this.writeFn = writeFn;
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
    if (this.rafId === null && !this.disposed) {
      this.lastTime = 0;
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  /** Immediate jump — cancel loop, set position, call writeFn once. */
  snap(value: number): void {
    this.position = value;
    this.velocity = 0;
    this.target = value;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.writeFn(value);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(now: number): void {
    if (this.disposed) return;

    if (this.lastTime === 0) {
      this.lastTime = now;
      this.writeFn(this.position);
      this.rafId = requestAnimationFrame((t) => this.tick(t));
      return;
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

    if (this.position === this.target && this.velocity === 0) {
      this.rafId = null;
    } else {
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }
}

/* ── SpringAnimator — 64-bin histogram bars ── */

export class SpringAnimator {
  private onFlush: (positions: Float64Array) => void;
  private positions: Float64Array;
  private velocities: Float64Array;
  private targets: Float64Array;
  private rafId: number | null = null;
  private lastTime = 0;
  private disposed = false;
  private hasRun = false;

  constructor(onFlush: (positions: Float64Array) => void) {
    this.onFlush = onFlush;
    this.positions = new Float64Array(64);
    this.velocities = new Float64Array(64);
    this.targets = new Float64Array(64);
  }

  /** Normalize bins and retarget the spring. Starts the rAF loop if not running. */
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
    // Start loop if not already running
    if (this.rafId === null && !this.disposed) {
      this.lastTime = 0;
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(now: number): void {
    if (this.disposed) return;

    // First frame: no dt, just record time
    if (this.lastTime === 0) {
      this.lastTime = now;
      this.flush();
      this.rafId = requestAnimationFrame((t) => this.tick(t));
      return;
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

    if (allSettled) {
      this.rafId = null;
    } else {
      this.rafId = requestAnimationFrame((t) => this.tick(t));
    }
  }

  private flush(): void {
    this.onFlush(this.positions);
  }
}
