import { useState, useEffect, useRef } from 'react';
import { cx } from 'class-variance-authority';
import { inlineInput } from './recipes';

interface InlineInputProps {
  value: string;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  /** Fill container width instead of auto-sizing to content */
  fullWidth?: boolean;
  onCommit: (val: string) => void;
}

/**
 * Always renders an <input> — styled as plain text when unfocused,
 * shows accent underline on focus. Zero DOM swap = zero layout shift.
 */
export default function InlineInput({ value, placeholder, mono, className, fullWidth, onCommit }: InlineInputProps) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const skipBlur = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);

  const handleBlur = () => {
    if (skipBlur.current) { skipBlur.current = false; setFocused(false); return; }
    const v = draft.trim();
    if (v !== value) onCommit(v);
    setFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); }
    if (e.key === 'Escape') {
      skipBlur.current = true;
      setDraft(value);
      setFocused(false);
      ref.current?.blur();
    }
  };

  const display = focused ? draft : value;
  const len = Math.max(display.length, placeholder?.length ?? 4) + 1;

  return (
    <input
      ref={ref}
      value={display}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => { setDraft(value); setFocused(true); }}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={cx(
        inlineInput({ font: mono ? 'mono' : 'body' }),
        className,
      )}
      style={fullWidth ? undefined : { width: `${len}ch` }}
    />
  );
}
