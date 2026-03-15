import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import AuthProvider from './providers/AuthProvider';
import './index.css';
import App from './App';

// DuckDB WASM removed — all Parquet queries run server-side via Arrow IPC.

// ── TEMPORARY: Font rendering debugger ───────────────────────────────────────
if (import.meta.env.DEV) {
  document.fonts.addEventListener('loadingdone', (e) => {
    const ev = e as FontFaceSetLoadEvent;
    const names = ev.fontfaces.map((f) => `${f.family} ${f.weight} ${f.style}`);
    console.log('[FONT] loadingdone', performance.now().toFixed(1) + 'ms', names);
  });
  document.fonts.ready.then(() => {
    console.log('[FONT] all fonts ready', performance.now().toFixed(1) + 'ms');
  });

  // Track ALL text-rendering properties on both heading and body elements
  const tracked = new Map<string, string>();
  const PROPS = [
    'fontFamily',
    'fontWeight',
    'fontSize',
    'letterSpacing',
    'fontKerning',
    'fontVariationSettings',
    'textRendering',
    'webkitFontSmoothing',
    'fontSmooth',
    'fontOpticalSizing',
  ] as const;

  const snapshot = (label: string, el: Element) => {
    const cs = getComputedStyle(el);
    const sig = PROPS.map((p) => (cs as any)[p]).join('|');
    const prev = tracked.get(label);
    if (sig !== prev) {
      tracked.set(label, sig);
      const detail: Record<string, string> = {};
      PROPS.forEach((p) => {
        detail[p] = (cs as any)[p];
      });
      // Check for GPU compositing clues
      detail['willChange'] = cs.willChange;
      detail['transform'] = cs.transform;
      detail['opacity'] = cs.opacity;
      detail['backfaceVisibility'] = cs.backfaceVisibility;
      detail['animation'] = cs.animationName + ' ' + cs.animationPlayState;
      console.log(
        `[FONT:${prev ? 'SHIFT' : 'INIT'}] ${label}`,
        performance.now().toFixed(1) + 'ms',
        detail,
      );
    }
  };

  const poll = () => {
    const heading = document.querySelector('h2, h1, [class*="heading"]');
    const body = document.querySelector('p, span, td, [class*="font-sans"]');
    const mono = document.querySelector('code, pre, [class*="font-mono"]');
    if (heading) snapshot('heading', heading);
    if (body) snapshot('body', body);
    if (mono) snapshot('mono', mono);
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);

  // Layout shift observer
  const lo = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if ((entry as any).value > 0.001) {
        console.log(
          '[LAYOUT:SHIFT]',
          performance.now().toFixed(1) + 'ms',
          'score:',
          (entry as any).value.toFixed(4),
        );
      }
    }
  });
  try {
    lo.observe({ type: 'layout-shift', buffered: true });
  } catch {}
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--color-surface-elevated)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body)',
              },
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
