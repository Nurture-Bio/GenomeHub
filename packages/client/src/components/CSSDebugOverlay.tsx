import { useState, useEffect, useCallback } from 'react';

/**
 * CSS Debug Overlay — hover any element to see its computed styles.
 * Toggle with Ctrl+Shift+D.
 */
export default function CSSDebugOverlay() {
  const [active, setActive] = useState(false);
  const [info, setInfo] = useState<{
    tag: string;
    classes: string;
    styles: Record<string, string>;
    rect: DOMRect;
  } | null>(null);

  const handleMove = useCallback((e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (!el || el.closest('[data-css-debug]')) return;

    const computed = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    setInfo({
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString() || '',
      rect,
      styles: {
        'font-size': computed.fontSize,
        'font-family': computed.fontFamily.split(',')[0].trim(),
        'font-weight': computed.fontWeight,
        'line-height': computed.lineHeight,
        'color': computed.color,
        'background': computed.backgroundColor,
        'padding': computed.padding,
        'margin': computed.margin,
        'gap': computed.gap,
        'display': computed.display,
        'position': computed.position,
        'width': `${Math.round(rect.width)}px`,
        'height': `${Math.round(rect.height)}px`,
        'border': computed.border,
        'box-shadow': computed.boxShadow === 'none' ? '' : computed.boxShadow,
        'opacity': computed.opacity === '1' ? '' : computed.opacity,
        'z-index': computed.zIndex === 'auto' ? '' : computed.zIndex,
      },
    });
  }, []);

  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setActive((v) => !v);
        setInfo(null);
      }
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);

  useEffect(() => {
    if (!active) return;
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [active, handleMove]);

  if (!active || !info) return null;

  const filtered = Object.entries(info.styles).filter(([, v]) => v && v !== 'none' && v !== 'static' && v !== '0px');

  return (
    <div
      data-css-debug
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        width: 380,
        maxHeight: '90vh',
        overflow: 'auto',
        background: '#0a0a0c',
        border: '1px solid #3f4059',
        borderRadius: 8,
        padding: 12,
        zIndex: 99999,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: '#f3f3f7',
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#69ccf0', fontWeight: 700, marginBottom: 4 }}>
        &lt;{info.tag}&gt;
      </div>
      {info.classes && (
        <div style={{ color: '#a0a2b5', wordBreak: 'break-all', marginBottom: 8 }}>
          {info.classes.length > 200 ? info.classes.slice(0, 200) + '…' : info.classes}
        </div>
      )}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {filtered.map(([prop, val]) => (
            <tr key={prop}>
              <td style={{ color: '#a0a2b5', paddingRight: 8, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                {prop}
              </td>
              <td style={{ color: '#f3f3f7', wordBreak: 'break-all' }}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
