import { useState, useEffect, useRef } from 'react';

interface InlineInputProps {
  value: string;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  onCommit: (val: string) => void;
}

/**
 * Always renders an <input> — styled as plain text when unfocused,
 * shows accent underline on focus. Zero DOM swap = zero layout shift.
 */
export default function InlineInput({ value, placeholder, mono, className, onCommit }: InlineInputProps) {
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
      className={[
        'bg-transparent border-b outline-none p-0 transition-colors duration-fast',
        focused ? 'border-accent cursor-text' : 'border-transparent hover:border-border-subtle cursor-pointer',
        mono ? 'font-mono text-caption text-text' : 'text-caption text-text-secondary',
        className ?? '',
      ].join(' ')}
      style={{ width: `${len}ch` }}
    />
  );
}
