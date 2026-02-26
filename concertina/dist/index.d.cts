export { ConcertinaContext, ConcertinaRootProps, ConcertinaStore, Content, Item, Root, UseConcertinaReturn, useConcertina, useExpanded } from './accordion.cjs';
export { Header, Trigger } from '@radix-ui/react-accordion';
import * as react from 'react';
import { HTMLAttributes, ElementType, ReactNode, Ref, ReactElement, AnimationEvent, DependencyList, CSSProperties } from 'react';
import * as react_jsx_runtime from 'react/jsx-runtime';

type Axis = "width" | "height" | "both";
interface BellowsProps extends HTMLAttributes<HTMLElement> {
    /** Which axis to stabilize. Default: "both". */
    axis?: Axis;
    /** Active note identifier. Slots with a matching `note` prop become active. */
    activeNote?: string;
    /** HTML element to render. Use "span" inside buttons. Default: "div". */
    as?: ElementType;
}
/**
 * Grid container that auto-sizes to the largest child.
 * All children overlap in the same grid cell (1/1).
 * Use <Slot active={bool}> or <Slot note="..."> as children.
 *
 * Zero JS measurement — pure CSS grid sizing.
 */
declare const Bellows: react.ForwardRefExoticComponent<BellowsProps & react.RefAttributes<HTMLElement>>;

interface SlotProps extends HTMLAttributes<HTMLElement> {
    /** Whether this slot is the active (visible) variant. Overrides `note` context. */
    active?: boolean;
    /** Note identifier. Active when it matches the parent Bellows `activeNote`. */
    note?: string;
    /** HTML element to render. Use "span" inside buttons. Default: "div". */
    as?: ElementType;
}
/**
 * A single variant inside a <Bellows> (or <StableSlot>).
 * All slots overlap via CSS grid. Inactive slots are hidden
 * but still contribute to grid cell sizing.
 *
 * Inactive hiding uses inline styles (can't be overridden by CSS cascade)
 * plus the [inert] attribute for accessibility (non-focusable, non-interactive).
 * CSS `.concertina-stable-slot > [inert]` serves as a backup.
 */
declare const Slot: react.ForwardRefExoticComponent<SlotProps & react.RefAttributes<HTMLElement>>;

interface HumProps extends HTMLAttributes<HTMLElement> {
    /**
     * Whether data is loading. Shows shimmer when true, children when false.
     * When omitted, falls back to the nearest `<Vamp>` ancestor's loading state.
     */
    loading?: boolean;
    /** HTML element to render. Default: "span". */
    as?: ElementType;
}
/**
 * Loading-aware text wrapper.
 *
 * When loading, renders children as an inert ghost inside a shimmer.
 * The ghost gives the shimmer its intrinsic width — exactly as wide
 * as the text it replaces. No forced width, no layout blow-out in
 * flex or inline contexts.
 *
 * The className is passed through so `1lh` inherits the correct font
 * metrics from the consuming context.
 *
 * When no explicit `loading` prop is provided, Hum reads from the
 * nearest `<Vamp>` ancestor. This lets a single provider control
 * shimmer state for an entire subtree.
 */
declare function Hum({ loading, as: Tag, className, children, ...props }: HumProps): react_jsx_runtime.JSX.Element;

/** Context carrying the ambient loading state set by Vamp. */
declare const VampContext: react.Context<boolean>;
/**
 * Read the nearest Vamp's loading state.
 * Returns `false` when no Vamp ancestor exists.
 */
declare function useVamp(): boolean;
interface VampProps {
    /** Whether the subtree is in a loading/warmup state. */
    loading: boolean;
    children: ReactNode;
}
/**
 * Ambient loading provider — musical "vamping" (repeating a pattern
 * while waiting for a cue).
 *
 * Wrapping a subtree in `<Vamp loading>` lets every nested `<Hum>`
 * pick up the loading state automatically, without threading an
 * explicit `loading` prop through every cell.
 */
declare function Vamp({ loading, children }: VampProps): react_jsx_runtime.JSX.Element;

interface OvertureProps extends HTMLAttributes<HTMLElement> {
    /** Whether data is loading. Sets Vamp context for all nested Hum instances. */
    loading: boolean;
    /** Exit animation duration in ms. Must match CSS --concertina-close-duration. */
    exitDuration: number;
    /** HTML element to render. Default: "div". */
    as?: ElementType;
}
/**
 * Loading-aware subtree wrapper — the opening act before the real content.
 *
 * Composes three behaviors into one component:
 * - **Vamp** context: every nested `<Hum>` reads loading state automatically.
 * - **Gigbag** ratchet: container never shrinks during the shimmer-to-content swap.
 * - **Exit transition**: applies `concertina-warmup-exiting` class during the
 *   fade-out so shimmer lines animate before real content mounts.
 *
 * Write one JSX tree for both states. Hum instances handle the visual toggle.
 *
 * ```tsx
 * <Overture loading={isLoading} exitDuration={150}>
 *   <h2><Hum className="text-xl">{user?.name}</Hum></h2>
 *   <p><Hum className="text-sm">{user?.bio}</Hum></p>
 * </Overture>
 * ```
 */
declare const Overture: react.ForwardRefExoticComponent<OvertureProps & react.RefAttributes<HTMLElement>>;

interface EnsembleProps<T> extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    /** Data items to render. */
    items: T[];
    /** Whether data is loading. Shows warmup stubs when true. */
    loading: boolean;
    /** Render function for each item. */
    renderItem: (item: T, index: number) => ReactNode;
    /** Number of placeholder rows during loading. */
    stubCount: number;
    /** Exit animation duration in ms. Must match CSS --concertina-close-duration. */
    exitDuration: number;
    /** HTML element to render. Default: "div". */
    as?: ElementType;
}
/**
 * Loading-aware collection.
 *
 * Shows warmup shimmer stubs while loading, then transitions
 * to rendered items. Wrapped in a Gigbag ratchet to prevent
 * layout shift during the transition.
 */
declare const Ensemble: <T>(props: EnsembleProps<T> & {
    ref?: Ref<HTMLElement>;
}) => ReactElement | null;

interface GigbagProps extends HTMLAttributes<HTMLElement> {
    /** Which axis to ratchet. Default: "height". */
    axis?: Axis;
    /** HTML element to render. Default: "div". */
    as?: ElementType;
}
/**
 * Size-reserving container.
 *
 * Remembers its largest-ever size (ResizeObserver ratchet) and never
 * shrinks. Swap a spinner for a table inside — no reflow.
 *
 * Uses `contain: layout style` to isolate internal reflow from
 * ancestors.
 */
declare const Gigbag: react.ForwardRefExoticComponent<GigbagProps & react.RefAttributes<HTMLElement>>;

interface WarmupProps extends HTMLAttributes<HTMLElement> {
    /** Number of placeholder rows. */
    rows: number;
    /** Number of columns per row. */
    columns?: number;
    /** HTML element to render. Default: "div". */
    as?: ElementType;
}
/**
 * Structural placeholder — CSS-only shimmer grid.
 *
 * Renders `rows x columns` animated bones that approximate the
 * dimensions of the real content. Pair with <Gigbag> so the
 * container ratchets to the larger of placeholder vs real content.
 *
 * All dimensions are CSS custom properties — consuming apps theme
 * without forking.
 */
declare const Warmup: react.ForwardRefExoticComponent<WarmupProps & react.RefAttributes<HTMLElement>>;

interface WarmupLineProps extends HTMLAttributes<HTMLElement> {
    /** HTML element to render. Default: "div". */
    as?: ElementType;
}
/**
 * Single shimmer line — CSS-aware placeholder for text.
 *
 * Sizes itself via `height: 1lh` — the CSS `lh` unit resolves to
 * the element's computed line-height. The shimmer inherits font
 * styles from its context, so it's exactly as tall as the text it
 * replaces. No magic numbers, no manual token mapping.
 *
 * Pass `className` to apply the same text styles as the content
 * this shimmer stands in for. Width fills the container by default
 * (block element).
 */
declare const WarmupLine: react.ForwardRefExoticComponent<WarmupLineProps & react.RefAttributes<HTMLElement>>;

interface GlideProps extends HTMLAttributes<HTMLElement> {
    /** Whether the content is visible. */
    show: boolean;
    /** HTML element to render. Default: "div". */
    as?: ElementType;
}
/**
 * Enter/exit animation wrapper.
 *
 * Thin composition over usePresence. Adds CSS class names:
 *   concertina-glide-entering, concertina-glide-exiting
 */
declare const Glide: react.ForwardRefExoticComponent<GlideProps & react.RefAttributes<HTMLElement>>;

interface Size {
    width: number;
    height: number;
}
interface UseSizeReturn {
    /** RefCallback — attach to the element to observe. */
    ref: (el: HTMLElement | null) => void;
    /** Current border-box size. NaN before first observation. */
    size: Size;
}
/**
 * Raw border-box size observation via ResizeObserver.
 *
 * Reports every resize — no ratchet, no policy. Use this when you
 * need the actual current size for your own logic (e.g. breakpoints,
 * conditional rendering, animations).
 *
 * For a ratcheting min-size that only grows, use useStableSlot instead.
 *
 * @deprecated Use `<Gigbag>` instead.
 */
declare function useSize(): UseSizeReturn;

type Phase = "entering" | "entered" | "exiting";
interface UsePresenceReturn {
    /** Whether the element should be in the DOM. */
    mounted: boolean;
    /** Current animation phase. */
    phase: Phase;
    /** Attach to the animating element's onAnimationEnd. */
    onAnimationEnd: (e: AnimationEvent) => void;
}
/**
 * Mount/unmount state machine for enter/exit animations.
 *
 * State transitions:
 *   show=true  → mount + "entering" → animationEnd → "entered"
 *   show=false → "exiting" → animationEnd → unmount
 *
 * Extracted from Glide so any component can use animated presence.
 *
 * @deprecated Use `<Glide>` instead.
 */
declare function usePresence(show: boolean): UsePresenceReturn;

/**
 * Pin an element to the top of its scroll container after layout changes.
 *
 * Runs pinToScrollTop inside useLayoutEffect — after React commits
 * the DOM but before the browser paints. This ensures scroll
 * correction happens synchronously with layout changes.
 *
 * Extracted from accordion Root so any component can do scroll pinning.
 */
declare function useScrollPin(getElement: () => HTMLElement | null, deps: DependencyList): void;

interface UseStableSlotOptions {
    /** Which axis to ratchet. Default: "both". */
    axis?: Axis;
}
interface UseStableSlotReturn {
    /** RefCallback — attach to the container element. */
    ref: (el: HTMLElement | null) => void;
    /** Spread onto the element: { minWidth?, minHeight? } */
    style: CSSProperties;
}
/**
 * ResizeObserver ratchet for dynamic content.
 *
 * Watches the element, tracks maximum width/height ever observed,
 * applies min-width/min-height that only ratchets up.
 *
 * Five things work together:
 * 1. ResizeObserver uses borderBoxSize — includes padding/border
 * 2. Ratchet is one-way — max only increases, never resets
 * 3. setStyle only called when ratchet grows — no infinite loops
 * 4. RefCallback disconnects observer on unmount — no leak
 * 5. SSR graceful no-op — typeof ResizeObserver guard
 *
 * @deprecated Use `<Gigbag>` instead.
 */
declare function useStableSlot(options?: UseStableSlotOptions): UseStableSlotReturn;

/**
 * Suppress CSS transitions during batched state changes.
 *
 * Three things work together:
 * 1. lock() sets the flag synchronously — batched with state changes in React 18
 * 2. After DOM commit (useLayoutEffect window) — consumer does measurement/scroll/pin work
 * 3. useEffect auto-clears the flag after paint — transitions re-enable
 *
 * Usage:
 *   const { locked, lock } = useTransitionLock();
 *   <div data-locked={locked || undefined}>...</div>
 *
 * @deprecated Use `<Root>` instead.
 */
declare function useTransitionLock(): {
    readonly locked: boolean;
    readonly lock: () => void;
};

/**
 * Scroll `el` to the top of its nearest scrollable ancestor,
 * clearing any sticky headers. Only adjusts one container's
 * scrollTop. Never cascades to the viewport, which matters on
 * mobile where scrollIntoView pulls the whole page.
 *
 * Skips elements that have overflow: auto/scroll in CSS but
 * don't actually scroll (scrollHeight <= clientHeight). Without
 * this check, a non-scrolling ancestor with overflow-auto traps
 * the walk and the real scroll container never gets adjusted.
 */
declare function pinToScrollTop(el: HTMLElement | null): void;

/**
 * Manages the warmup → content transition for stub-data tables.
 *
 * When `loading` transitions from true to false, holds stub data
 * for one animation cycle so warmup lines can fade out before
 * real content mounts.
 *
 * @deprecated Use `<Ensemble>` instead.
 * @param loading - Whether data is still loading
 * @param duration - Exit animation duration in ms. Must match CSS --concertina-close-duration.
 */
declare function useWarmupExit(loading: boolean, duration: number): {
    /** True during loading AND during exit animation — use for data selection */
    showWarmup: boolean;
    /** True only during the exit animation — use for CSS class */
    exiting: boolean;
};

export { type Axis, Bellows, type BellowsProps, Ensemble, type EnsembleProps, Gigbag, type GigbagProps, Glide, type GlideProps, Hum, type HumProps, Overture, type OvertureProps, type Phase, type Size, Slot, type SlotProps, Ensemble as StableCollection, type EnsembleProps as StableCollectionProps, Bellows as StableSlot, type BellowsProps as StableSlotProps, Hum as StableText, type HumProps as StableTextProps, type UsePresenceReturn, Vamp, VampContext, type VampProps, Warmup, WarmupLine, type WarmupLineProps, type WarmupProps, pinToScrollTop, usePresence, useScrollPin, useSize, useStableSlot, useTransitionLock, useVamp, useWarmupExit };
