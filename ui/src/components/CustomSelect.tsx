import React, { useEffect, useRef, useState } from 'react';

type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export default function CustomSelect(props: Props): JSX.Element {
  const { options, value, onChange, placeholder = 'Select...', disabled, className } = props;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() => Math.max(0, options.findIndex(o => o.value === value)));
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    setHighlight(Math.max(0, options.findIndex(o => o.value === value)));
  }, [value, options]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[Math.min(highlight, listRef.current.children.length - 1)] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlight]);

  function toggle() {
    if (disabled) return;
    setOpen(v => !v);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[highlight];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const selected = options.find(o => o.value === value);

  return (
    <div ref={wrapperRef} className={`holonSelectWrapper relative ${className ?? ''}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={`holonSelect flex items-center justify-between ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" className="ml-2 flex-shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 8l5 5 5-5" stroke="#59b8f6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          tabIndex={-1}
          ref={listRef}
          className="absolute z-50 mt-2 w-full max-h-60 overflow-auto custom-scrollbar rounded-2xl bg-card holonSelectList border border-white/6 shadow-lg p-2"
          onKeyDown={onKeyDown}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`px-4 py-3 rounded-xl cursor-pointer ${i === highlight ? 'bg-white/6' : ''} ${o.value === value ? 'font-semibold' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
