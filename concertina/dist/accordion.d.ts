import * as react from 'react';
import * as Accordion from '@radix-ui/react-accordion';
export { Header, Trigger } from '@radix-ui/react-accordion';

declare const Root: react.ForwardRefExoticComponent<Omit<Omit<Accordion.AccordionSingleProps & react.RefAttributes<HTMLDivElement>, "ref"> & {
    type?: "single";
    collapsible?: boolean;
}, "type"> & react.RefAttributes<HTMLDivElement>>;

declare const Item: react.ForwardRefExoticComponent<Omit<Accordion.AccordionItemProps & react.RefAttributes<HTMLDivElement>, "ref"> & react.RefAttributes<HTMLDivElement>>;

declare const Content: react.ForwardRefExoticComponent<Omit<Accordion.AccordionContentProps & react.RefAttributes<HTMLDivElement>, "ref"> & react.RefAttributes<HTMLDivElement>>;

/**
 * Per-item expansion hook. Returns true only when this item is expanded.
 *
 * Uses useSyncExternalStore so the component only re-renders when
 * its own boolean flips — not on every accordion state change.
 */
declare function useExpanded(id: string): boolean;

type Listener = () => void;
/**
 * External store for concertina accordion state.
 * Lives outside React — one instance per Root.
 * Holds value + item refs. Switching logic moved to useTransitionLock.
 */
declare class ConcertinaStore {
    private _value;
    private _itemRefs;
    private _listeners;
    subscribe: (listener: Listener) => (() => void);
    private _notify;
    getValue: () => string;
    setValue(newValue: string): void;
    getItemRef(id: string): HTMLElement | null;
    setItemRef(id: string, el: HTMLElement | null): void;
}
declare const ConcertinaContext: react.Context<ConcertinaStore | null>;

interface ConcertinaRootProps {
    value: string;
    onValueChange: (value: string) => void;
    "data-switching"?: true;
}
interface UseConcertinaReturn {
    /** Currently expanded item value, empty string when collapsed. */
    value: string;
    /** Change handler. Manages switching state automatically. */
    onValueChange: (value: string) => void;
    /** True during a switch between items (animations suppressed). */
    switching: boolean;
    /** Spread onto Accordion.Root. Includes value, onValueChange, data-switching. */
    rootProps: ConcertinaRootProps;
    /** Returns a ref callback for an Accordion.Item. Pass the item's value. */
    getItemRef: (id: string) => (el: HTMLElement | null) => void;
}
/**
 * React hook for scroll-pinned Radix Accordion panels.
 *
 * Handles five things:
 * 1. Suppresses close/open animations when switching between items
 * 2. Pins the newly opened item to the top of the scroll container
 * 3. Uses scrollTop adjustment instead of scrollIntoView (no viewport cascade)
 * 4. Coordinates React state batching so layout is final before scroll measurement
 * 5. Clears the switching flag after paint so future animations work normally
 *
 * @deprecated Use `<Root>` instead.
 */
declare function useConcertina(): UseConcertinaReturn;

export { ConcertinaContext, type ConcertinaRootProps, ConcertinaStore, Content, Item, Root, type UseConcertinaReturn, useConcertina, useExpanded };
