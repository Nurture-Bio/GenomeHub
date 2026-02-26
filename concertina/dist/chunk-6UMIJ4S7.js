// node_modules/@radix-ui/react-accordion/dist/index.mjs
import React12 from "react";

// node_modules/@radix-ui/react-context/dist/index.mjs
import * as React from "react";
import { jsx } from "react/jsx-runtime";
function createContextScope(scopeName, createContextScopeDeps = []) {
  let defaultContexts = [];
  function createContext32(rootComponentName, defaultContext) {
    const BaseContext = React.createContext(defaultContext);
    const index = defaultContexts.length;
    defaultContexts = [...defaultContexts, defaultContext];
    const Provider = (props) => {
      const { scope, children, ...context } = props;
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const value = React.useMemo(() => context, Object.values(context));
      return /* @__PURE__ */ jsx(Context.Provider, { value, children });
    };
    Provider.displayName = rootComponentName + "Provider";
    function useContext22(consumerName, scope) {
      const Context = scope?.[scopeName]?.[index] || BaseContext;
      const context = React.useContext(Context);
      if (context) return context;
      if (defaultContext !== void 0) return defaultContext;
      throw new Error(`\`${consumerName}\` must be used within \`${rootComponentName}\``);
    }
    return [Provider, useContext22];
  }
  const createScope = () => {
    const scopeContexts = defaultContexts.map((defaultContext) => {
      return React.createContext(defaultContext);
    });
    return function useScope(scope) {
      const contexts = scope?.[scopeName] || scopeContexts;
      return React.useMemo(
        () => ({ [`__scope${scopeName}`]: { ...scope, [scopeName]: contexts } }),
        [scope, contexts]
      );
    };
  };
  createScope.scopeName = scopeName;
  return [createContext32, composeContextScopes(createScope, ...createContextScopeDeps)];
}
function composeContextScopes(...scopes) {
  const baseScope = scopes[0];
  if (scopes.length === 1) return baseScope;
  const createScope = () => {
    const scopeHooks = scopes.map((createScope2) => ({
      useScope: createScope2(),
      scopeName: createScope2.scopeName
    }));
    return function useComposedScopes(overrideScopes) {
      const nextScopes = scopeHooks.reduce((nextScopes2, { useScope, scopeName }) => {
        const scopeProps = useScope(overrideScopes);
        const currentScope = scopeProps[`__scope${scopeName}`];
        return { ...nextScopes2, ...currentScope };
      }, {});
      return React.useMemo(() => ({ [`__scope${baseScope.scopeName}`]: nextScopes }), [nextScopes]);
    };
  };
  createScope.scopeName = baseScope.scopeName;
  return createScope;
}

// node_modules/@radix-ui/react-collection/dist/index.mjs
import React4 from "react";

// node_modules/@radix-ui/react-compose-refs/dist/index.mjs
import * as React2 from "react";
function setRef(ref, value) {
  if (typeof ref === "function") {
    return ref(value);
  } else if (ref !== null && ref !== void 0) {
    ref.current = value;
  }
}
function composeRefs(...refs) {
  return (node) => {
    let hasCleanup = false;
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node);
      if (!hasCleanup && typeof cleanup == "function") {
        hasCleanup = true;
      }
      return cleanup;
    });
    if (hasCleanup) {
      return () => {
        for (let i = 0; i < cleanups.length; i++) {
          const cleanup = cleanups[i];
          if (typeof cleanup == "function") {
            cleanup();
          } else {
            setRef(refs[i], null);
          }
        }
      };
    }
  };
}
function useComposedRefs(...refs) {
  return React2.useCallback(composeRefs(...refs), refs);
}

// node_modules/@radix-ui/react-slot/dist/index.mjs
import * as React3 from "react";
import { Fragment as Fragment2, jsx as jsx2 } from "react/jsx-runtime";
// @__NO_SIDE_EFFECTS__
function createSlot(ownerName) {
  const SlotClone = /* @__PURE__ */ createSlotClone(ownerName);
  const Slot2 = React3.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = React3.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (React3.Children.count(newElement) > 1) return React3.Children.only(null);
          return React3.isValidElement(newElement) ? newElement.props.children : null;
        } else {
          return child;
        }
      });
      return /* @__PURE__ */ jsx2(SlotClone, { ...slotProps, ref: forwardedRef, children: React3.isValidElement(newElement) ? React3.cloneElement(newElement, void 0, newChildren) : null });
    }
    return /* @__PURE__ */ jsx2(SlotClone, { ...slotProps, ref: forwardedRef, children });
  });
  Slot2.displayName = `${ownerName}.Slot`;
  return Slot2;
}
// @__NO_SIDE_EFFECTS__
function createSlotClone(ownerName) {
  const SlotClone = React3.forwardRef((props, forwardedRef) => {
    const { children, ...slotProps } = props;
    if (React3.isValidElement(children)) {
      const childrenRef = getElementRef(children);
      const props2 = mergeProps(slotProps, children.props);
      if (children.type !== React3.Fragment) {
        props2.ref = forwardedRef ? composeRefs(forwardedRef, childrenRef) : childrenRef;
      }
      return React3.cloneElement(children, props2);
    }
    return React3.Children.count(children) > 1 ? React3.Children.only(null) : null;
  });
  SlotClone.displayName = `${ownerName}.SlotClone`;
  return SlotClone;
}
var SLOTTABLE_IDENTIFIER = /* @__PURE__ */ Symbol("radix.slottable");
function isSlottable(child) {
  return React3.isValidElement(child) && typeof child.type === "function" && "__radixId" in child.type && child.type.__radixId === SLOTTABLE_IDENTIFIER;
}
function mergeProps(slotProps, childProps) {
  const overrideProps = { ...childProps };
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    const isHandler = /^on[A-Z]/.test(propName);
    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args) => {
          const result = childPropValue(...args);
          slotPropValue(...args);
          return result;
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = { ...slotPropValue, ...childPropValue };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(" ");
    }
  }
  return { ...slotProps, ...overrideProps };
}
function getElementRef(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}

// node_modules/@radix-ui/react-collection/dist/index.mjs
import { jsx as jsx3 } from "react/jsx-runtime";
import React22 from "react";
import { jsx as jsx22 } from "react/jsx-runtime";
function createCollection(name) {
  const PROVIDER_NAME = name + "CollectionProvider";
  const [createCollectionContext, createCollectionScope2] = createContextScope(PROVIDER_NAME);
  const [CollectionProviderImpl, useCollectionContext] = createCollectionContext(
    PROVIDER_NAME,
    { collectionRef: { current: null }, itemMap: /* @__PURE__ */ new Map() }
  );
  const CollectionProvider = (props) => {
    const { scope, children } = props;
    const ref = React4.useRef(null);
    const itemMap = React4.useRef(/* @__PURE__ */ new Map()).current;
    return /* @__PURE__ */ jsx3(CollectionProviderImpl, { scope, itemMap, collectionRef: ref, children });
  };
  CollectionProvider.displayName = PROVIDER_NAME;
  const COLLECTION_SLOT_NAME = name + "CollectionSlot";
  const CollectionSlotImpl = createSlot(COLLECTION_SLOT_NAME);
  const CollectionSlot = React4.forwardRef(
    (props, forwardedRef) => {
      const { scope, children } = props;
      const context = useCollectionContext(COLLECTION_SLOT_NAME, scope);
      const composedRefs = useComposedRefs(forwardedRef, context.collectionRef);
      return /* @__PURE__ */ jsx3(CollectionSlotImpl, { ref: composedRefs, children });
    }
  );
  CollectionSlot.displayName = COLLECTION_SLOT_NAME;
  const ITEM_SLOT_NAME = name + "CollectionItemSlot";
  const ITEM_DATA_ATTR = "data-radix-collection-item";
  const CollectionItemSlotImpl = createSlot(ITEM_SLOT_NAME);
  const CollectionItemSlot = React4.forwardRef(
    (props, forwardedRef) => {
      const { scope, children, ...itemData } = props;
      const ref = React4.useRef(null);
      const composedRefs = useComposedRefs(forwardedRef, ref);
      const context = useCollectionContext(ITEM_SLOT_NAME, scope);
      React4.useEffect(() => {
        context.itemMap.set(ref, { ref, ...itemData });
        return () => void context.itemMap.delete(ref);
      });
      return /* @__PURE__ */ jsx3(CollectionItemSlotImpl, { ...{ [ITEM_DATA_ATTR]: "" }, ref: composedRefs, children });
    }
  );
  CollectionItemSlot.displayName = ITEM_SLOT_NAME;
  function useCollection2(scope) {
    const context = useCollectionContext(name + "CollectionConsumer", scope);
    const getItems = React4.useCallback(() => {
      const collectionNode = context.collectionRef.current;
      if (!collectionNode) return [];
      const orderedNodes = Array.from(collectionNode.querySelectorAll(`[${ITEM_DATA_ATTR}]`));
      const items = Array.from(context.itemMap.values());
      const orderedItems = items.sort(
        (a, b) => orderedNodes.indexOf(a.ref.current) - orderedNodes.indexOf(b.ref.current)
      );
      return orderedItems;
    }, [context.collectionRef, context.itemMap]);
    return getItems;
  }
  return [
    { Provider: CollectionProvider, Slot: CollectionSlot, ItemSlot: CollectionItemSlot },
    useCollection2,
    createCollectionScope2
  ];
}

// node_modules/@radix-ui/primitive/dist/index.mjs
var canUseDOM = !!(typeof window !== "undefined" && window.document && window.document.createElement);
function composeEventHandlers(originalEventHandler, ourEventHandler, { checkForDefaultPrevented = true } = {}) {
  return function handleEvent(event) {
    originalEventHandler?.(event);
    if (checkForDefaultPrevented === false || !event.defaultPrevented) {
      return ourEventHandler?.(event);
    }
  };
}

// node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
import * as React6 from "react";

// node_modules/@radix-ui/react-use-layout-effect/dist/index.mjs
import * as React5 from "react";
var useLayoutEffect2 = globalThis?.document ? React5.useLayoutEffect : () => {
};

// node_modules/@radix-ui/react-use-controllable-state/dist/index.mjs
import * as React23 from "react";
var useInsertionEffect = React6[" useInsertionEffect ".trim().toString()] || useLayoutEffect2;
function useControllableState({
  prop,
  defaultProp,
  onChange = () => {
  },
  caller
}) {
  const [uncontrolledProp, setUncontrolledProp, onChangeRef] = useUncontrolledState({
    defaultProp,
    onChange
  });
  const isControlled = prop !== void 0;
  const value = isControlled ? prop : uncontrolledProp;
  if (true) {
    const isControlledRef = React6.useRef(prop !== void 0);
    React6.useEffect(() => {
      const wasControlled = isControlledRef.current;
      if (wasControlled !== isControlled) {
        const from = wasControlled ? "controlled" : "uncontrolled";
        const to = isControlled ? "controlled" : "uncontrolled";
        console.warn(
          `${caller} is changing from ${from} to ${to}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`
        );
      }
      isControlledRef.current = isControlled;
    }, [isControlled, caller]);
  }
  const setValue = React6.useCallback(
    (nextValue) => {
      if (isControlled) {
        const value2 = isFunction(nextValue) ? nextValue(prop) : nextValue;
        if (value2 !== prop) {
          onChangeRef.current?.(value2);
        }
      } else {
        setUncontrolledProp(nextValue);
      }
    },
    [isControlled, prop, setUncontrolledProp, onChangeRef]
  );
  return [value, setValue];
}
function useUncontrolledState({
  defaultProp,
  onChange
}) {
  const [value, setValue] = React6.useState(defaultProp);
  const prevValueRef = React6.useRef(value);
  const onChangeRef = React6.useRef(onChange);
  useInsertionEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  React6.useEffect(() => {
    if (prevValueRef.current !== value) {
      onChangeRef.current?.(value);
      prevValueRef.current = value;
    }
  }, [value, prevValueRef]);
  return [value, setValue, onChangeRef];
}
function isFunction(value) {
  return typeof value === "function";
}

// node_modules/@radix-ui/react-primitive/dist/index.mjs
import * as React7 from "react";
import * as ReactDOM from "react-dom";
import { jsx as jsx4 } from "react/jsx-runtime";
var NODES = [
  "a",
  "button",
  "div",
  "form",
  "h2",
  "h3",
  "img",
  "input",
  "label",
  "li",
  "nav",
  "ol",
  "p",
  "select",
  "span",
  "svg",
  "ul"
];
var Primitive = NODES.reduce((primitive, node) => {
  const Slot = createSlot(`Primitive.${node}`);
  const Node2 = React7.forwardRef((props, forwardedRef) => {
    const { asChild, ...primitiveProps } = props;
    const Comp = asChild ? Slot : node;
    if (typeof window !== "undefined") {
      window[/* @__PURE__ */ Symbol.for("radix-ui")] = true;
    }
    return /* @__PURE__ */ jsx4(Comp, { ...primitiveProps, ref: forwardedRef });
  });
  Node2.displayName = `Primitive.${node}`;
  return { ...primitive, [node]: Node2 };
}, {});

// node_modules/@radix-ui/react-collapsible/dist/index.mjs
import * as React10 from "react";

// node_modules/@radix-ui/react-presence/dist/index.mjs
import * as React24 from "react";
import * as React8 from "react";
function useStateMachine(initialState, machine) {
  return React8.useReducer((state, event) => {
    const nextState = machine[state][event];
    return nextState ?? state;
  }, initialState);
}
var Presence = (props) => {
  const { present, children } = props;
  const presence = usePresence(present);
  const child = typeof children === "function" ? children({ present: presence.isPresent }) : React24.Children.only(children);
  const ref = useComposedRefs(presence.ref, getElementRef2(child));
  const forceMount = typeof children === "function";
  return forceMount || presence.isPresent ? React24.cloneElement(child, { ref }) : null;
};
Presence.displayName = "Presence";
function usePresence(present) {
  const [node, setNode] = React24.useState();
  const stylesRef = React24.useRef(null);
  const prevPresentRef = React24.useRef(present);
  const prevAnimationNameRef = React24.useRef("none");
  const initialState = present ? "mounted" : "unmounted";
  const [state, send] = useStateMachine(initialState, {
    mounted: {
      UNMOUNT: "unmounted",
      ANIMATION_OUT: "unmountSuspended"
    },
    unmountSuspended: {
      MOUNT: "mounted",
      ANIMATION_END: "unmounted"
    },
    unmounted: {
      MOUNT: "mounted"
    }
  });
  React24.useEffect(() => {
    const currentAnimationName = getAnimationName(stylesRef.current);
    prevAnimationNameRef.current = state === "mounted" ? currentAnimationName : "none";
  }, [state]);
  useLayoutEffect2(() => {
    const styles = stylesRef.current;
    const wasPresent = prevPresentRef.current;
    const hasPresentChanged = wasPresent !== present;
    if (hasPresentChanged) {
      const prevAnimationName = prevAnimationNameRef.current;
      const currentAnimationName = getAnimationName(styles);
      if (present) {
        send("MOUNT");
      } else if (currentAnimationName === "none" || styles?.display === "none") {
        send("UNMOUNT");
      } else {
        const isAnimating = prevAnimationName !== currentAnimationName;
        if (wasPresent && isAnimating) {
          send("ANIMATION_OUT");
        } else {
          send("UNMOUNT");
        }
      }
      prevPresentRef.current = present;
    }
  }, [present, send]);
  useLayoutEffect2(() => {
    if (node) {
      let timeoutId;
      const ownerWindow = node.ownerDocument.defaultView ?? window;
      const handleAnimationEnd = (event) => {
        const currentAnimationName = getAnimationName(stylesRef.current);
        const isCurrentAnimation = currentAnimationName.includes(CSS.escape(event.animationName));
        if (event.target === node && isCurrentAnimation) {
          send("ANIMATION_END");
          if (!prevPresentRef.current) {
            const currentFillMode = node.style.animationFillMode;
            node.style.animationFillMode = "forwards";
            timeoutId = ownerWindow.setTimeout(() => {
              if (node.style.animationFillMode === "forwards") {
                node.style.animationFillMode = currentFillMode;
              }
            });
          }
        }
      };
      const handleAnimationStart = (event) => {
        if (event.target === node) {
          prevAnimationNameRef.current = getAnimationName(stylesRef.current);
        }
      };
      node.addEventListener("animationstart", handleAnimationStart);
      node.addEventListener("animationcancel", handleAnimationEnd);
      node.addEventListener("animationend", handleAnimationEnd);
      return () => {
        ownerWindow.clearTimeout(timeoutId);
        node.removeEventListener("animationstart", handleAnimationStart);
        node.removeEventListener("animationcancel", handleAnimationEnd);
        node.removeEventListener("animationend", handleAnimationEnd);
      };
    } else {
      send("ANIMATION_END");
    }
  }, [node, send]);
  return {
    isPresent: ["mounted", "unmountSuspended"].includes(state),
    ref: React24.useCallback((node2) => {
      stylesRef.current = node2 ? getComputedStyle(node2) : null;
      setNode(node2);
    }, [])
  };
}
function getAnimationName(styles) {
  return styles?.animationName || "none";
}
function getElementRef2(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, "ref")?.get;
  let mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.ref;
  }
  getter = Object.getOwnPropertyDescriptor(element, "ref")?.get;
  mayWarn = getter && "isReactWarning" in getter && getter.isReactWarning;
  if (mayWarn) {
    return element.props.ref;
  }
  return element.props.ref || element.ref;
}

// node_modules/@radix-ui/react-id/dist/index.mjs
import * as React9 from "react";
var useReactId = React9[" useId ".trim().toString()] || (() => void 0);
var count = 0;
function useId(deterministicId) {
  const [id, setId] = React9.useState(useReactId());
  useLayoutEffect2(() => {
    if (!deterministicId) setId((reactId) => reactId ?? String(count++));
  }, [deterministicId]);
  return deterministicId || (id ? `radix-${id}` : "");
}

// node_modules/@radix-ui/react-collapsible/dist/index.mjs
import { jsx as jsx5 } from "react/jsx-runtime";
var COLLAPSIBLE_NAME = "Collapsible";
var [createCollapsibleContext, createCollapsibleScope] = createContextScope(COLLAPSIBLE_NAME);
var [CollapsibleProvider, useCollapsibleContext] = createCollapsibleContext(COLLAPSIBLE_NAME);
var Collapsible = React10.forwardRef(
  (props, forwardedRef) => {
    const {
      __scopeCollapsible,
      open: openProp,
      defaultOpen,
      disabled,
      onOpenChange,
      ...collapsibleProps
    } = props;
    const [open, setOpen] = useControllableState({
      prop: openProp,
      defaultProp: defaultOpen ?? false,
      onChange: onOpenChange,
      caller: COLLAPSIBLE_NAME
    });
    return /* @__PURE__ */ jsx5(
      CollapsibleProvider,
      {
        scope: __scopeCollapsible,
        disabled,
        contentId: useId(),
        open,
        onOpenToggle: React10.useCallback(() => setOpen((prevOpen) => !prevOpen), [setOpen]),
        children: /* @__PURE__ */ jsx5(
          Primitive.div,
          {
            "data-state": getState(open),
            "data-disabled": disabled ? "" : void 0,
            ...collapsibleProps,
            ref: forwardedRef
          }
        )
      }
    );
  }
);
Collapsible.displayName = COLLAPSIBLE_NAME;
var TRIGGER_NAME = "CollapsibleTrigger";
var CollapsibleTrigger = React10.forwardRef(
  (props, forwardedRef) => {
    const { __scopeCollapsible, ...triggerProps } = props;
    const context = useCollapsibleContext(TRIGGER_NAME, __scopeCollapsible);
    return /* @__PURE__ */ jsx5(
      Primitive.button,
      {
        type: "button",
        "aria-controls": context.contentId,
        "aria-expanded": context.open || false,
        "data-state": getState(context.open),
        "data-disabled": context.disabled ? "" : void 0,
        disabled: context.disabled,
        ...triggerProps,
        ref: forwardedRef,
        onClick: composeEventHandlers(props.onClick, context.onOpenToggle)
      }
    );
  }
);
CollapsibleTrigger.displayName = TRIGGER_NAME;
var CONTENT_NAME = "CollapsibleContent";
var CollapsibleContent = React10.forwardRef(
  (props, forwardedRef) => {
    const { forceMount, ...contentProps } = props;
    const context = useCollapsibleContext(CONTENT_NAME, props.__scopeCollapsible);
    return /* @__PURE__ */ jsx5(Presence, { present: forceMount || context.open, children: ({ present }) => /* @__PURE__ */ jsx5(CollapsibleContentImpl, { ...contentProps, ref: forwardedRef, present }) });
  }
);
CollapsibleContent.displayName = CONTENT_NAME;
var CollapsibleContentImpl = React10.forwardRef((props, forwardedRef) => {
  const { __scopeCollapsible, present, children, ...contentProps } = props;
  const context = useCollapsibleContext(CONTENT_NAME, __scopeCollapsible);
  const [isPresent, setIsPresent] = React10.useState(present);
  const ref = React10.useRef(null);
  const composedRefs = useComposedRefs(forwardedRef, ref);
  const heightRef = React10.useRef(0);
  const height = heightRef.current;
  const widthRef = React10.useRef(0);
  const width = widthRef.current;
  const isOpen = context.open || isPresent;
  const isMountAnimationPreventedRef = React10.useRef(isOpen);
  const originalStylesRef = React10.useRef(void 0);
  React10.useEffect(() => {
    const rAF = requestAnimationFrame(() => isMountAnimationPreventedRef.current = false);
    return () => cancelAnimationFrame(rAF);
  }, []);
  useLayoutEffect2(() => {
    const node = ref.current;
    if (node) {
      originalStylesRef.current = originalStylesRef.current || {
        transitionDuration: node.style.transitionDuration,
        animationName: node.style.animationName
      };
      node.style.transitionDuration = "0s";
      node.style.animationName = "none";
      const rect = node.getBoundingClientRect();
      heightRef.current = rect.height;
      widthRef.current = rect.width;
      if (!isMountAnimationPreventedRef.current) {
        node.style.transitionDuration = originalStylesRef.current.transitionDuration;
        node.style.animationName = originalStylesRef.current.animationName;
      }
      setIsPresent(present);
    }
  }, [context.open, present]);
  return /* @__PURE__ */ jsx5(
    Primitive.div,
    {
      "data-state": getState(context.open),
      "data-disabled": context.disabled ? "" : void 0,
      id: context.contentId,
      hidden: !isOpen,
      ...contentProps,
      ref: composedRefs,
      style: {
        [`--radix-collapsible-content-height`]: height ? `${height}px` : void 0,
        [`--radix-collapsible-content-width`]: width ? `${width}px` : void 0,
        ...props.style
      },
      children: isOpen && children
    }
  );
});
function getState(open) {
  return open ? "open" : "closed";
}
var Root = Collapsible;
var Trigger = CollapsibleTrigger;
var Content = CollapsibleContent;

// node_modules/@radix-ui/react-direction/dist/index.mjs
import * as React11 from "react";
import { jsx as jsx6 } from "react/jsx-runtime";
var DirectionContext = React11.createContext(void 0);
function useDirection(localDir) {
  const globalDir = React11.useContext(DirectionContext);
  return localDir || globalDir || "ltr";
}

// node_modules/@radix-ui/react-accordion/dist/index.mjs
import { jsx as jsx7 } from "react/jsx-runtime";
var ACCORDION_NAME = "Accordion";
var ACCORDION_KEYS = ["Home", "End", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
var [Collection, useCollection, createCollectionScope] = createCollection(ACCORDION_NAME);
var [createAccordionContext, createAccordionScope] = createContextScope(ACCORDION_NAME, [
  createCollectionScope,
  createCollapsibleScope
]);
var useCollapsibleScope = createCollapsibleScope();
var Accordion = React12.forwardRef(
  (props, forwardedRef) => {
    const { type, ...accordionProps } = props;
    const singleProps = accordionProps;
    const multipleProps = accordionProps;
    return /* @__PURE__ */ jsx7(Collection.Provider, { scope: props.__scopeAccordion, children: type === "multiple" ? /* @__PURE__ */ jsx7(AccordionImplMultiple, { ...multipleProps, ref: forwardedRef }) : /* @__PURE__ */ jsx7(AccordionImplSingle, { ...singleProps, ref: forwardedRef }) });
  }
);
Accordion.displayName = ACCORDION_NAME;
var [AccordionValueProvider, useAccordionValueContext] = createAccordionContext(ACCORDION_NAME);
var [AccordionCollapsibleProvider, useAccordionCollapsibleContext] = createAccordionContext(
  ACCORDION_NAME,
  { collapsible: false }
);
var AccordionImplSingle = React12.forwardRef(
  (props, forwardedRef) => {
    const {
      value: valueProp,
      defaultValue,
      onValueChange = () => {
      },
      collapsible = false,
      ...accordionSingleProps
    } = props;
    const [value, setValue] = useControllableState({
      prop: valueProp,
      defaultProp: defaultValue ?? "",
      onChange: onValueChange,
      caller: ACCORDION_NAME
    });
    return /* @__PURE__ */ jsx7(
      AccordionValueProvider,
      {
        scope: props.__scopeAccordion,
        value: React12.useMemo(() => value ? [value] : [], [value]),
        onItemOpen: setValue,
        onItemClose: React12.useCallback(() => collapsible && setValue(""), [collapsible, setValue]),
        children: /* @__PURE__ */ jsx7(AccordionCollapsibleProvider, { scope: props.__scopeAccordion, collapsible, children: /* @__PURE__ */ jsx7(AccordionImpl, { ...accordionSingleProps, ref: forwardedRef }) })
      }
    );
  }
);
var AccordionImplMultiple = React12.forwardRef((props, forwardedRef) => {
  const {
    value: valueProp,
    defaultValue,
    onValueChange = () => {
    },
    ...accordionMultipleProps
  } = props;
  const [value, setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? [],
    onChange: onValueChange,
    caller: ACCORDION_NAME
  });
  const handleItemOpen = React12.useCallback(
    (itemValue) => setValue((prevValue = []) => [...prevValue, itemValue]),
    [setValue]
  );
  const handleItemClose = React12.useCallback(
    (itemValue) => setValue((prevValue = []) => prevValue.filter((value2) => value2 !== itemValue)),
    [setValue]
  );
  return /* @__PURE__ */ jsx7(
    AccordionValueProvider,
    {
      scope: props.__scopeAccordion,
      value,
      onItemOpen: handleItemOpen,
      onItemClose: handleItemClose,
      children: /* @__PURE__ */ jsx7(AccordionCollapsibleProvider, { scope: props.__scopeAccordion, collapsible: true, children: /* @__PURE__ */ jsx7(AccordionImpl, { ...accordionMultipleProps, ref: forwardedRef }) })
    }
  );
});
var [AccordionImplProvider, useAccordionContext] = createAccordionContext(ACCORDION_NAME);
var AccordionImpl = React12.forwardRef(
  (props, forwardedRef) => {
    const { __scopeAccordion, disabled, dir, orientation = "vertical", ...accordionProps } = props;
    const accordionRef = React12.useRef(null);
    const composedRefs = useComposedRefs(accordionRef, forwardedRef);
    const getItems = useCollection(__scopeAccordion);
    const direction = useDirection(dir);
    const isDirectionLTR = direction === "ltr";
    const handleKeyDown = composeEventHandlers(props.onKeyDown, (event) => {
      if (!ACCORDION_KEYS.includes(event.key)) return;
      const target = event.target;
      const triggerCollection = getItems().filter((item) => !item.ref.current?.disabled);
      const triggerIndex = triggerCollection.findIndex((item) => item.ref.current === target);
      const triggerCount = triggerCollection.length;
      if (triggerIndex === -1) return;
      event.preventDefault();
      let nextIndex = triggerIndex;
      const homeIndex = 0;
      const endIndex = triggerCount - 1;
      const moveNext = () => {
        nextIndex = triggerIndex + 1;
        if (nextIndex > endIndex) {
          nextIndex = homeIndex;
        }
      };
      const movePrev = () => {
        nextIndex = triggerIndex - 1;
        if (nextIndex < homeIndex) {
          nextIndex = endIndex;
        }
      };
      switch (event.key) {
        case "Home":
          nextIndex = homeIndex;
          break;
        case "End":
          nextIndex = endIndex;
          break;
        case "ArrowRight":
          if (orientation === "horizontal") {
            if (isDirectionLTR) {
              moveNext();
            } else {
              movePrev();
            }
          }
          break;
        case "ArrowDown":
          if (orientation === "vertical") {
            moveNext();
          }
          break;
        case "ArrowLeft":
          if (orientation === "horizontal") {
            if (isDirectionLTR) {
              movePrev();
            } else {
              moveNext();
            }
          }
          break;
        case "ArrowUp":
          if (orientation === "vertical") {
            movePrev();
          }
          break;
      }
      const clampedIndex = nextIndex % triggerCount;
      triggerCollection[clampedIndex].ref.current?.focus();
    });
    return /* @__PURE__ */ jsx7(
      AccordionImplProvider,
      {
        scope: __scopeAccordion,
        disabled,
        direction: dir,
        orientation,
        children: /* @__PURE__ */ jsx7(Collection.Slot, { scope: __scopeAccordion, children: /* @__PURE__ */ jsx7(
          Primitive.div,
          {
            ...accordionProps,
            "data-orientation": orientation,
            ref: composedRefs,
            onKeyDown: disabled ? void 0 : handleKeyDown
          }
        ) })
      }
    );
  }
);
var ITEM_NAME = "AccordionItem";
var [AccordionItemProvider, useAccordionItemContext] = createAccordionContext(ITEM_NAME);
var AccordionItem = React12.forwardRef(
  (props, forwardedRef) => {
    const { __scopeAccordion, value, ...accordionItemProps } = props;
    const accordionContext = useAccordionContext(ITEM_NAME, __scopeAccordion);
    const valueContext = useAccordionValueContext(ITEM_NAME, __scopeAccordion);
    const collapsibleScope = useCollapsibleScope(__scopeAccordion);
    const triggerId = useId();
    const open = value && valueContext.value.includes(value) || false;
    const disabled = accordionContext.disabled || props.disabled;
    return /* @__PURE__ */ jsx7(
      AccordionItemProvider,
      {
        scope: __scopeAccordion,
        open,
        disabled,
        triggerId,
        children: /* @__PURE__ */ jsx7(
          Root,
          {
            "data-orientation": accordionContext.orientation,
            "data-state": getState2(open),
            ...collapsibleScope,
            ...accordionItemProps,
            ref: forwardedRef,
            disabled,
            open,
            onOpenChange: (open2) => {
              if (open2) {
                valueContext.onItemOpen(value);
              } else {
                valueContext.onItemClose(value);
              }
            }
          }
        )
      }
    );
  }
);
AccordionItem.displayName = ITEM_NAME;
var HEADER_NAME = "AccordionHeader";
var AccordionHeader = React12.forwardRef(
  (props, forwardedRef) => {
    const { __scopeAccordion, ...headerProps } = props;
    const accordionContext = useAccordionContext(ACCORDION_NAME, __scopeAccordion);
    const itemContext = useAccordionItemContext(HEADER_NAME, __scopeAccordion);
    return /* @__PURE__ */ jsx7(
      Primitive.h3,
      {
        "data-orientation": accordionContext.orientation,
        "data-state": getState2(itemContext.open),
        "data-disabled": itemContext.disabled ? "" : void 0,
        ...headerProps,
        ref: forwardedRef
      }
    );
  }
);
AccordionHeader.displayName = HEADER_NAME;
var TRIGGER_NAME2 = "AccordionTrigger";
var AccordionTrigger = React12.forwardRef(
  (props, forwardedRef) => {
    const { __scopeAccordion, ...triggerProps } = props;
    const accordionContext = useAccordionContext(ACCORDION_NAME, __scopeAccordion);
    const itemContext = useAccordionItemContext(TRIGGER_NAME2, __scopeAccordion);
    const collapsibleContext = useAccordionCollapsibleContext(TRIGGER_NAME2, __scopeAccordion);
    const collapsibleScope = useCollapsibleScope(__scopeAccordion);
    return /* @__PURE__ */ jsx7(Collection.ItemSlot, { scope: __scopeAccordion, children: /* @__PURE__ */ jsx7(
      Trigger,
      {
        "aria-disabled": itemContext.open && !collapsibleContext.collapsible || void 0,
        "data-orientation": accordionContext.orientation,
        id: itemContext.triggerId,
        ...collapsibleScope,
        ...triggerProps,
        ref: forwardedRef
      }
    ) });
  }
);
AccordionTrigger.displayName = TRIGGER_NAME2;
var CONTENT_NAME2 = "AccordionContent";
var AccordionContent = React12.forwardRef(
  (props, forwardedRef) => {
    const { __scopeAccordion, ...contentProps } = props;
    const accordionContext = useAccordionContext(ACCORDION_NAME, __scopeAccordion);
    const itemContext = useAccordionItemContext(CONTENT_NAME2, __scopeAccordion);
    const collapsibleScope = useCollapsibleScope(__scopeAccordion);
    return /* @__PURE__ */ jsx7(
      Content,
      {
        role: "region",
        "aria-labelledby": itemContext.triggerId,
        "data-orientation": accordionContext.orientation,
        ...collapsibleScope,
        ...contentProps,
        ref: forwardedRef,
        style: {
          ["--radix-accordion-content-height"]: "var(--radix-collapsible-content-height)",
          ["--radix-accordion-content-width"]: "var(--radix-collapsible-content-width)",
          ...props.style
        }
      }
    );
  }
);
AccordionContent.displayName = CONTENT_NAME2;
function getState2(open) {
  return open ? "open" : "closed";
}
var Root2 = Accordion;
var Item = AccordionItem;
var Header = AccordionHeader;
var Trigger2 = AccordionTrigger;
var Content2 = AccordionContent;

// src/accordion/store.ts
import { createContext as createContext3 } from "react";
var ConcertinaStore = class {
  constructor() {
    this._value = "";
    this._itemRefs = {};
    this._listeners = /* @__PURE__ */ new Set();
    this.subscribe = (listener) => {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    };
    this.getValue = () => this._value;
  }
  _notify() {
    for (const listener of this._listeners) listener();
  }
  setValue(newValue) {
    this._value = newValue || "";
    this._notify();
  }
  getItemRef(id) {
    return this._itemRefs[id] ?? null;
  }
  setItemRef(id, el) {
    this._itemRefs[id] = el;
  }
};
var ConcertinaContext = createContext3(null);

// src/primitives/pin-to-scroll-top.ts
function pinToScrollTop(el) {
  if (!el) return;
  let parent = el.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      const box = parent.getBoundingClientRect();
      const target = el.getBoundingClientRect();
      let stickyOffset = 0;
      const measure = (node) => {
        const s = getComputedStyle(node);
        if (s.position === "sticky") {
          stickyOffset = Math.max(
            stickyOffset,
            (parseFloat(s.top) || 0) + node.getBoundingClientRect().height
          );
        }
      };
      for (const child of parent.children) {
        measure(child);
        for (const gc of child.children) measure(gc);
      }
      parent.scrollTop += target.top - box.top - stickyOffset;
      return;
    }
    parent = parent.parentElement;
  }
}

// src/primitives/use-scroll-pin.ts
import { useLayoutEffect as useLayoutEffect3 } from "react";
function useScrollPin(getElement, deps) {
  useLayoutEffect3(() => {
    const el = getElement();
    if (!el) return;
    pinToScrollTop(el);
  }, deps);
}

// src/primitives/use-transition-lock.ts
import { useState as useState5, useEffect as useEffect5, useCallback as useCallback5 } from "react";
function useTransitionLock() {
  const [locked, setLocked] = useState5(false);
  const lock = useCallback5(() => setLocked(true), []);
  useEffect5(() => {
    if (locked) setLocked(false);
  }, [locked]);
  return { locked, lock };
}

// src/accordion/root.tsx
import {
  forwardRef as forwardRef4,
  useRef as useRef5,
  useSyncExternalStore,
  useCallback as useCallback6
} from "react";
import { jsx as jsx8 } from "react/jsx-runtime";
var Root3 = forwardRef4(
  function Root4({ collapsible = true, children, ...props }, forwardedRef) {
    const storeRef = useRef5(null);
    if (!storeRef.current) {
      storeRef.current = new ConcertinaStore();
    }
    const store = storeRef.current;
    const value = useSyncExternalStore(
      store.subscribe,
      store.getValue,
      store.getValue
    );
    const { locked, lock } = useTransitionLock();
    const onValueChange = useCallback6(
      (newValue) => {
        const isSwitching = !!store.getValue() && store.getValue() !== newValue && !!newValue;
        if (isSwitching) lock();
        store.setValue(newValue);
      },
      [store, lock]
    );
    useScrollPin(
      () => value ? store.getItemRef(value) : null,
      [value, store]
    );
    return /* @__PURE__ */ jsx8(ConcertinaContext.Provider, { value: store, children: /* @__PURE__ */ jsx8(
      Root2,
      {
        ref: forwardedRef,
        type: "single",
        collapsible,
        value,
        onValueChange,
        "data-switching": locked || void 0,
        ...props,
        children
      }
    ) });
  }
);

// src/accordion/item.tsx
import {
  forwardRef as forwardRef5,
  useContext as useContext3,
  useMemo as useMemo3
} from "react";

// src/internal/merge-refs.ts
function mergeRefs(...refs) {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref != null) {
        ref.current = value;
      }
    }
  };
}

// src/accordion/item.tsx
import { jsx as jsx9 } from "react/jsx-runtime";
var Item2 = forwardRef5(function Item3({ value, ...props }, forwardedRef) {
  const store = useContext3(ConcertinaContext);
  const mergedRef = useMemo3(
    () => mergeRefs(forwardedRef, (el) => store?.setItemRef(value, el)),
    [forwardedRef, store, value]
  );
  return /* @__PURE__ */ jsx9(Item, { ref: mergedRef, value, ...props });
});

// src/accordion/content.tsx
import { forwardRef as forwardRef6, useInsertionEffect as useInsertionEffect2 } from "react";

// src/styles.css
var styles_default = `/* concertina \u2014 Radix Accordion expand/collapse with scroll pinning support
 *
 * Add .concertina-content to your Accordion.Content elements.
 * The [data-switching] rules are managed automatically by useConcertina().
 */

.concertina-content {
  --concertina-open-duration: 200ms;
  --concertina-close-duration: 150ms;
  overflow: hidden;
}

.concertina-content[data-state="open"] {
  animation: concertina-open var(--concertina-open-duration) ease-out;
}

.concertina-content[data-state="closed"] {
  animation: concertina-close var(--concertina-close-duration) ease-out forwards;
}

@keyframes concertina-open {
  from {
    height: 0;
    opacity: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
    opacity: 1;
  }
}

@keyframes concertina-close {
  from {
    height: var(--radix-accordion-content-height);
    opacity: 1;
  }
  to {
    height: 0;
    opacity: 0;
  }
}

/* When switching between items, run animations instantly so layout
   is in its final state for scroll pinning. Uses duration: 0s rather
   than animation: none to avoid re-triggering the close animation
   when data-switching is cleared after paint.
   data-switching is set by useConcertina(), cleared after paint. */
[data-switching] .concertina-content[data-state="closed"] {
  animation-duration: 0s;
}

[data-switching] .concertina-content[data-state="open"] {
  animation-duration: 0s;
}

/* StableSlot \u2014 all children overlap in the same grid cell.
   Grid auto-sizes to the largest child.
   Slots use flex-column so their content stretches to fill
   the reserved width \u2014 the visual footprint is constant. */
.concertina-stable-slot {
  display: grid;
}
.concertina-stable-slot > * {
  grid-area: 1 / 1;
  display: flex;
  flex-direction: column;
}

/* Inactive Slot hiding \u2014 belt and suspenders.
   Primary: inline style on the Slot element (visibility: hidden + opacity: 0).
   Inline styles can't be overridden by any CSS cascade \u2014 this is the
   bulletproof layer.
   Backup: CSS rules below catch edge cases (e.g. if inline styles are
   stripped by a framework or test harness).
   transition: none on descendants prevents children with transition-all
   from animating the inherited visibility change. */
.concertina-stable-slot > [inert] {
  visibility: hidden;
  opacity: 0;
}
.concertina-stable-slot > [inert] * {
  transition: none;
}

/* Gigbag \u2014 size-reserving container.
   contain isolates internal reflow from ancestors. */
.concertina-gigbag {
  contain: layout style;
}

/* Warmup \u2014 structural placeholder shimmer grid. */
.concertina-warmup {
  display: grid;
  gap: var(--concertina-warmup-gap, 0.75rem);
  contain: layout style;
}

.concertina-warmup-bone {
  display: flex;
  flex-direction: column;
  gap: var(--concertina-warmup-bone-gap, 0.125rem);
  padding: var(--concertina-warmup-bone-padding, 0.375rem 0.5rem);
}

.concertina-warmup-line {
  height: 1lh;
  border-radius: var(--concertina-warmup-line-radius, 0.125rem);
  background: linear-gradient(
    90deg,
    var(--concertina-warmup-line-color, #e5e7eb) 25%,
    var(--concertina-warmup-line-highlight, #f3f4f6) 50%,
    var(--concertina-warmup-line-color, #e5e7eb) 75%
  );
  background-size: 200% 100%;
  animation: concertina-shimmer 1.5s ease-in-out infinite;
}

/* Inert ghost inside a warmup-line \u2014 sizes the shimmer to match
   content width exactly. Invisible and non-interactive via [inert]. */
.concertina-warmup-line > [inert] {
  visibility: hidden;
}

@keyframes concertina-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}


/* Glide \u2014 enter/exit animation wrapper. */
.concertina-glide {
  --concertina-glide-duration: 200ms;
}

.concertina-glide-entering {
  animation: concertina-glide-in var(--concertina-glide-duration) ease-out;
}

.concertina-glide-exiting {
  animation: concertina-glide-out var(--concertina-glide-duration) ease-out forwards;
}

@keyframes concertina-glide-in {
  from { opacity: 0; max-height: 0; overflow: hidden; }
  to   { opacity: 1; max-height: var(--concertina-glide-height, 1000px); overflow: hidden; }
}

@keyframes concertina-glide-out {
  from { opacity: 1; max-height: var(--concertina-glide-height, 1000px); overflow: hidden; }
  to   { opacity: 0; max-height: 0; overflow: hidden; }
}

/* Warmup exit \u2014 fade out shimmer lines before content mounts.
   Applied by useWarmupExit() via className on the grid container. */
.concertina-warmup-exiting .concertina-warmup-line {
  animation: concertina-warmup-exit var(--concertina-close-duration, 150ms) ease-out forwards;
}

@keyframes concertina-warmup-exit {
  to { opacity: 0; }
}

/* Respect reduced-motion preferences.
   Disables all animations \u2014 accordion open/close, shimmer, and glide enter/exit.
   Layout changes still happen instantly so functionality is preserved. */
@media (prefers-reduced-motion: reduce) {
  .concertina-content[data-state="open"],
  .concertina-content[data-state="closed"],
  .concertina-glide-entering,
  .concertina-glide-exiting,
  .concertina-warmup-line,
  .concertina-warmup-exiting .concertina-warmup-line {
    animation-duration: 0s !important;
  }
}
`;

// src/internal/inject-styles.ts
var injected = false;
function injectStyles() {
  if (injected || typeof document === "undefined") return;
  if (document.querySelector("style[data-concertina]")) {
    injected = true;
    return;
  }
  const style = document.createElement("style");
  style.setAttribute("data-concertina", "");
  style.textContent = styles_default;
  document.head.appendChild(style);
  injected = true;
}
injectStyles();

// src/accordion/content.tsx
import { jsx as jsx10 } from "react/jsx-runtime";
var Content3 = forwardRef6(function Content4({ className, ...props }, ref) {
  useInsertionEffect2(injectStyles, []);
  const merged = className ? `concertina-content ${className}` : "concertina-content";
  return /* @__PURE__ */ jsx10(Content2, { ref, className: merged, ...props });
});

// src/accordion/use-expanded.ts
import { useContext as useContext4, useSyncExternalStore as useSyncExternalStore2 } from "react";
function useStore() {
  const store = useContext4(ConcertinaContext);
  if (!store) {
    throw new Error("useExpanded must be used inside <Concertina.Root>");
  }
  return store;
}
function useExpanded(id) {
  const store = useStore();
  return useSyncExternalStore2(
    store.subscribe,
    () => store.getValue() === id,
    () => false
    // server snapshot
  );
}

// src/accordion/use-concertina.ts
import {
  useState as useState6,
  useCallback as useCallback7,
  useRef as useRef6,
  useLayoutEffect as useLayoutEffect4,
  useEffect as useEffect6
} from "react";
function useConcertina() {
  const [value, setValue] = useState6("");
  const [switching, setSwitching] = useState6(false);
  const itemRefs = useRef6({});
  const onValueChange = useCallback7(
    (newValue) => {
      if (!newValue) {
        setSwitching(false);
        setValue("");
        return;
      }
      setSwitching(!!value && value !== newValue);
      setValue(newValue);
    },
    [value]
  );
  useLayoutEffect4(() => {
    if (!value) return;
    pinToScrollTop(itemRefs.current[value]);
  }, [value]);
  useEffect6(() => {
    if (switching) setSwitching(false);
  }, [switching]);
  const getItemRef = useCallback7(
    (id) => (el) => {
      itemRefs.current[id] = el;
    },
    []
  );
  const rootProps = {
    value,
    onValueChange,
    ...switching ? { "data-switching": true } : {}
  };
  return { value, onValueChange, switching, rootProps, getItemRef };
}

export {
  Header,
  Trigger2,
  ConcertinaStore,
  ConcertinaContext,
  pinToScrollTop,
  useScrollPin,
  useTransitionLock,
  Root3 as Root,
  mergeRefs,
  Item2 as Item,
  injectStyles,
  Content3 as Content,
  useExpanded,
  useConcertina
};
