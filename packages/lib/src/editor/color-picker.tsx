import { useEffect, useState } from 'react';
import { COLOR_PATTERN } from '../core';

export const DEFAULT_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#FF7F00', '#FFD700', '#00FF00', '#008000',
  '#00FFFF', '#0000FF', '#8B00FF', '#FF00FF', '#808080', '#C0C0C0', '#8B4513',
  '#FFC0CB', '#00FF7F',
];

const RECENT_KEY = 'react-ubb-recent-colors';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable — ignore */
  }
}

export interface ColorPickerProps {
  colors?: string[];
  onSelect(hex: string): void;
  onClose(): void;
}

export default function ColorPicker({ colors = DEFAULT_COLORS, onSelect, onClose }: ColorPickerProps) {
  const [hex, setHex] = useState(colors[0]);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commit = (value: string) => {
    if (!COLOR_PATTERN.test(value)) return;
    const next = [value, ...recent.filter((c) => c !== value)].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(next);
    onSelect(value);
  };

  return (
    <div className="react-ubb__overlay" onClick={onClose}>
      <div
        className="react-ubb__color-panel"
        role="dialog"
        aria-label="color picker"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="react-ubb__swatches">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              className="react-ubb__swatch"
              style={{ background: c }}
              aria-label={c}
              onClick={() => commit(c)}
            />
          ))}
        </div>
        <div className="react-ubb__color-custom">
          <input
            type="color"
            aria-label="custom color"
            value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'}
            onChange={(e) => setHex(e.target.value)}
          />
          <input
            className="react-ubb__hex-input"
            aria-label="hex"
            placeholder="#RRGGBB"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(hex);
            }}
          />
        </div>
        {recent.length > 0 && (
          <div className="react-ubb__swatches" data-testid="recent">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                className="react-ubb__swatch"
                style={{ background: c }}
                aria-label={`recent ${c}`}
                onClick={() => commit(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
