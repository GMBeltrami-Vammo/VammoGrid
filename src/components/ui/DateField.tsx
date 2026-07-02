'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { isoToDisplayDate, parseDisplayDate } from '@/lib/planning/format';

// A date field that ALWAYS displays and accepts DD-MM-YYYY (pt-BR), regardless of the
// browser/OS locale. The native <input type="date"> renders in the browser locale
// (often MM/DD/YYYY on en-US machines), which we don't want — every date in this app
// is DD-MM-YYYY. Value in/out is the canonical ISO YYYY-MM-DD string ('' when empty).
// Accepts '-' or '/' separators and 2- or 4-digit years while typing.

export function DateField({
  value,
  onChange,
  className,
  placeholder = 'dd-mm-aaaa',
  disabled,
  'aria-label': ariaLabel,
}: {
  /** Canonical ISO date (YYYY-MM-DD) or '' when empty. */
  value: string;
  /** Fires with the ISO date on a complete/valid entry, or '' when cleared. */
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(() => isoToDisplayDate(value));

  // Re-sync the display when the committed value changes from outside (reset / refresh).
  useEffect(() => {
    setText(isoToDisplayDate(value));
  }, [value]);

  const handleChange = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') {
      onChange('');
      return;
    }
    const iso = parseDisplayDate(raw);
    if (iso) onChange(iso);
  };

  // On blur, snap the text back to the canonical display of the committed value so a
  // half-typed/invalid entry doesn't linger.
  const handleBlur = () => setText(isoToDisplayDate(value));

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
    />
  );
}
