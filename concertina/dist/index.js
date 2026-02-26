import {
  ConcertinaContext,
  ConcertinaStore,
  Content,
  Header,
  Item,
  Root,
  Trigger2,
  injectStyles,
  mergeRefs,
  pinToScrollTop,
  useConcertina,
  useExpanded,
  useScrollPin,
  useTransitionLock
} from "./chunk-6UMIJ4S7.js";

// src/components/bellows.tsx
import {
  forwardRef,
  createContext,
  useInsertionEffect
} from "react";
import { jsx } from "react/jsx-runtime";
var AxisContext = createContext("both");
var ActiveNoteContext = createContext(void 0);
var Bellows = forwardRef(
  function Bellows2({ axis = "both", activeNote, as: Tag = "div", className, style, children, ...props }, ref) {
    useInsertionEffect(injectStyles, []);
    const merged = className ? `concertina-stable-slot ${className}` : "concertina-stable-slot";
    return /* @__PURE__ */ jsx(AxisContext.Provider, { value: axis, children: /* @__PURE__ */ jsx(ActiveNoteContext.Provider, { value: activeNote, children: /* @__PURE__ */ jsx(Tag, { ref, className: merged, style, ...props, children }) }) });
  }
);

// src/components/slot.tsx
import {
  forwardRef as forwardRef2,
  useContext,
  useInsertionEffect as useInsertionEffect2
} from "react";
import { jsx as jsx2 } from "react/jsx-runtime";
var HIDDEN_STYLE = { visibility: "hidden", opacity: 0 };
var Slot = forwardRef2(
  function Slot2({ active, note, as: Tag = "div", style, children, ...props }, ref) {
    useInsertionEffect2(injectStyles, []);
    useContext(AxisContext);
    const activeNote = useContext(ActiveNoteContext);
    const isActive = active ?? (note != null ? note === activeNote : true);
    const merged = isActive ? style : style ? { ...style, ...HIDDEN_STYLE } : HIDDEN_STYLE;
    return /* @__PURE__ */ jsx2(
      Tag,
      {
        ref,
        inert: !isActive || void 0,
        style: merged,
        ...props,
        children
      }
    );
  }
);

// src/components/vamp.tsx
import { createContext as createContext2, useContext as useContext2 } from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
var VampContext = createContext2(false);
function useVamp() {
  return useContext2(VampContext);
}
function Vamp({ loading, children }) {
  return /* @__PURE__ */ jsx3(VampContext.Provider, { value: loading, children });
}

// src/components/hum.tsx
import { jsx as jsx4 } from "react/jsx-runtime";
function Hum({ loading, as: Tag = "span", className, children, ...props }) {
  const vampLoading = useVamp();
  const isLoading = loading ?? vampLoading;
  if (isLoading) {
    const merged = className ? `concertina-warmup-line ${className}` : "concertina-warmup-line";
    return /* @__PURE__ */ jsx4(Tag, { className: merged, ...props, children: /* @__PURE__ */ jsx4(Tag, { inert: true, children }) });
  }
  return /* @__PURE__ */ jsx4(Tag, { className, ...props, children });
}

// src/components/overture.tsx
import {
  forwardRef as forwardRef4,
  useInsertionEffect as useInsertionEffect4
} from "react";

// src/components/gigbag.tsx
import { forwardRef as forwardRef3, useInsertionEffect as useInsertionEffect3 } from "react";

// src/primitives/use-stable-slot.ts
import { useState, useCallback, useRef } from "react";
var RATCHET_FLOOR = -Infinity;
function useStableSlot(options = {}) {
  const { axis = "both" } = options;
  const [style, setStyle] = useState({});
  const maxRef = useRef({ w: RATCHET_FLOOR, h: RATCHET_FLOOR });
  const observerRef = useRef(null);
  const ref = useCallback(
    (el) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!el || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          let w;
          let h;
          if (entry.borderBoxSize?.length) {
            const box = entry.borderBoxSize[0];
            w = box.inlineSize;
            h = box.blockSize;
          } else {
            const rect = entry.target.getBoundingClientRect();
            w = rect.width;
            h = rect.height;
          }
          const max = maxRef.current;
          let grew = false;
          if ((axis === "width" || axis === "both") && w > max.w) {
            max.w = w;
            grew = true;
          }
          if ((axis === "height" || axis === "both") && h > max.h) {
            max.h = h;
            grew = true;
          }
          if (grew) {
            const next = {};
            if (axis === "width" || axis === "both") next.minWidth = max.w;
            if (axis === "height" || axis === "both") next.minHeight = max.h;
            setStyle(next);
          }
        }
      });
      observer.observe(el, { box: "border-box" });
      observerRef.current = observer;
    },
    [axis]
  );
  return { ref, style };
}

// src/components/gigbag.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
var Gigbag = forwardRef3(
  function Gigbag2({ axis = "height", as: Tag = "div", className, style, children, ...props }, fwdRef) {
    useInsertionEffect3(injectStyles, []);
    const { ref: ratchetRef, style: ratchetStyle } = useStableSlot({ axis });
    const merged = className ? `concertina-gigbag ${className}` : "concertina-gigbag";
    return /* @__PURE__ */ jsx5(
      Tag,
      {
        ref: mergeRefs(ratchetRef, fwdRef),
        className: merged,
        style: { ...ratchetStyle, ...style },
        ...props,
        children
      }
    );
  }
);

// src/primitives/use-warmup-exit.ts
import { useState as useState2, useEffect, useRef as useRef2 } from "react";
function useWarmupExit(loading, duration) {
  const [exiting, setExiting] = useState2(false);
  const prevLoading = useRef2(loading);
  useEffect(() => {
    if (prevLoading.current && !loading) {
      setExiting(true);
      const id = setTimeout(() => setExiting(false), duration);
      prevLoading.current = loading;
      return () => clearTimeout(id);
    }
    prevLoading.current = loading;
  }, [loading, duration]);
  return {
    /** True during loading AND during exit animation — use for data selection */
    showWarmup: loading || exiting,
    /** True only during the exit animation — use for CSS class */
    exiting
  };
}

// src/components/overture.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
var Overture = forwardRef4(
  function Overture2({ loading, exitDuration, as: Tag = "div", className, children, ...props }, ref) {
    useInsertionEffect4(injectStyles, []);
    const { showWarmup, exiting } = useWarmupExit(loading, exitDuration);
    const merged = exiting ? className ? `concertina-warmup-exiting ${className}` : "concertina-warmup-exiting" : className;
    return /* @__PURE__ */ jsx6(Gigbag, { ref, axis: "height", as: Tag, className: merged, ...props, children: /* @__PURE__ */ jsx6(Vamp, { loading: showWarmup, children }) });
  }
);

// src/components/ensemble.tsx
import {
  forwardRef as forwardRef6,
  useInsertionEffect as useInsertionEffect6
} from "react";

// src/components/warmup.tsx
import { forwardRef as forwardRef5, useInsertionEffect as useInsertionEffect5 } from "react";
import { jsx as jsx7, jsxs } from "react/jsx-runtime";
var Warmup = forwardRef5(
  function Warmup2({ rows, columns, as: Tag = "div", className, children, ...props }, ref) {
    useInsertionEffect5(injectStyles, []);
    const merged = className ? `concertina-warmup ${className}` : "concertina-warmup";
    const count = columns ? rows * columns : rows;
    const cells = Array.from({ length: count }, (_, i) => /* @__PURE__ */ jsxs("div", { className: "concertina-warmup-bone", children: [
      /* @__PURE__ */ jsx7("div", { className: "concertina-warmup-line" }),
      /* @__PURE__ */ jsx7("div", { className: "concertina-warmup-line" })
    ] }, i));
    const gridStyle = columns ? { gridTemplateColumns: `repeat(${columns}, auto)`, gridTemplateAreas: `'${"chamber ".repeat(columns).trim()}'` } : { gridTemplateAreas: "'chamber'" };
    return /* @__PURE__ */ jsx7(
      Tag,
      {
        ref,
        className: merged,
        style: gridStyle,
        ...props,
        children: cells
      }
    );
  }
);

// src/components/ensemble.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
function EnsembleInner({
  items,
  loading,
  renderItem,
  stubCount,
  exitDuration,
  as: Tag = "div",
  className,
  ...props
}, ref) {
  useInsertionEffect6(injectStyles, []);
  const { showWarmup, exiting } = useWarmupExit(loading, exitDuration);
  const warmupClass = exiting ? className ? `concertina-warmup-exiting ${className}` : "concertina-warmup-exiting" : className;
  return /* @__PURE__ */ jsx8(Gigbag, { ref, axis: "height", as: Tag, ...props, children: showWarmup ? /* @__PURE__ */ jsx8(Warmup, { rows: stubCount, className: warmupClass }) : /* @__PURE__ */ jsx8(Tag, { className, children: items.map(renderItem) }) });
}
var Ensemble = forwardRef6(EnsembleInner);

// src/components/warmup-line.tsx
import { forwardRef as forwardRef7, useInsertionEffect as useInsertionEffect7 } from "react";
import { jsx as jsx9 } from "react/jsx-runtime";
var WarmupLine = forwardRef7(
  function WarmupLine2({ as: Tag = "div", className, ...props }, ref) {
    useInsertionEffect7(injectStyles, []);
    const merged = className ? `concertina-warmup-line ${className}` : "concertina-warmup-line";
    return /* @__PURE__ */ jsx9(Tag, { ref, className: merged, ...props });
  }
);

// src/components/glide.tsx
import {
  forwardRef as forwardRef8,
  useInsertionEffect as useInsertionEffect8
} from "react";

// src/primitives/use-presence.ts
import {
  useState as useState3,
  useEffect as useEffect2,
  useCallback as useCallback2
} from "react";
function usePresence(show) {
  const [mounted, setMounted] = useState3(show);
  const [phase, setPhase] = useState3(show ? "entered" : "exiting");
  useEffect2(() => {
    if (show) {
      setMounted(true);
      setPhase("entering");
    } else if (mounted) {
      setPhase("exiting");
    }
  }, [show]);
  const onAnimationEnd = useCallback2(
    (e) => {
      if (e.target !== e.currentTarget) return;
      if (phase === "entering") setPhase("entered");
      if (phase === "exiting") setMounted(false);
    },
    [phase]
  );
  return { mounted, phase, onAnimationEnd };
}

// src/components/glide.tsx
import { jsx as jsx10 } from "react/jsx-runtime";
var Glide = forwardRef8(
  function Glide2({ show, as: Tag = "div", className, children, ...props }, ref) {
    useInsertionEffect8(injectStyles, []);
    const { mounted, phase, onAnimationEnd } = usePresence(show);
    if (!mounted) return null;
    const phaseClass = phase === "entering" ? "concertina-glide-entering" : phase === "exiting" ? "concertina-glide-exiting" : "";
    const merged = ["concertina-glide", phaseClass, className].filter(Boolean).join(" ");
    return /* @__PURE__ */ jsx10(
      Tag,
      {
        ref,
        className: merged,
        onAnimationEnd,
        ...props,
        children
      }
    );
  }
);

// src/primitives/use-size.ts
import { useState as useState4, useCallback as useCallback3, useRef as useRef3 } from "react";
var NO_OBSERVATION = { width: Number.NaN, height: Number.NaN };
function useSize() {
  const [size, setSize] = useState4(NO_OBSERVATION);
  const observerRef = useRef3(null);
  const ref = useCallback3((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        let w;
        let h;
        if (entry.borderBoxSize?.length) {
          const box = entry.borderBoxSize[0];
          w = box.inlineSize;
          h = box.blockSize;
        } else {
          const rect = entry.target.getBoundingClientRect();
          w = rect.width;
          h = rect.height;
        }
        setSize({ width: w, height: h });
      }
    });
    observer.observe(el, { box: "border-box" });
    observerRef.current = observer;
  }, []);
  return { ref, size };
}
export {
  Bellows,
  ConcertinaContext,
  ConcertinaStore,
  Content,
  Ensemble,
  Gigbag,
  Glide,
  Header,
  Hum,
  Item,
  Overture,
  Root,
  Slot,
  Ensemble as StableCollection,
  Bellows as StableSlot,
  Hum as StableText,
  Trigger2 as Trigger,
  Vamp,
  VampContext,
  Warmup,
  WarmupLine,
  pinToScrollTop,
  useConcertina,
  useExpanded,
  usePresence,
  useScrollPin,
  useSize,
  useStableSlot,
  useTransitionLock,
  useVamp,
  useWarmupExit
};
