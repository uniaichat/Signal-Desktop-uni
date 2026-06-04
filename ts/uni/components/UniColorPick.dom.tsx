import React, { useState, useRef, useMemo } from 'react';
interface Props {
  value?: string; // "#RRGGBB"
  onChange?: (hex: string) => void;
}

/** HEX -> HUE */
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  if (d === 0) return 0;

  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d) % 6;
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    case b:
      h = (r - g) / d + 4;
      break;
  }

  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}

/** HUE -> HEX */
function hueToHex(h: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
    return Math.round(c);
  };

  const r = f(5);
  const g = f(3);
  const b = f(1);

  return (
    '#' +
    [r, g, b]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function UniColorPick({
  value = '#ff0000',
  onChange,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(value);
  const hue = useMemo(() => hexToHue(hex), [hex]);
  const latestHexRef = useRef(hex);

  const updateByX = (clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    let p = (clientX - rect.left) / rect.width;
    p = Math.max(0, Math.min(1, p));
    const h = Math.round(p * 360);
    const newHex = hueToHex(h);
    setHex(newHex);
    latestHexRef.current = newHex; // ⭐ 关键
  };
  const onMouseDown = (e: React.MouseEvent) => {
    updateByX(e.clientX);
    
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const onMouseMove = (e: MouseEvent) => updateByX(e.clientX);

  const onMouseUp = () => {
    onChange?.(latestHexRef.current); // ✅ 一定是最终值
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  const setColorDirect = (newHex: string) => {
    setHex(newHex);
    latestHexRef.current = newHex;
    onChange?.(newHex);
  };

  return (
    <div style={{ width: '200px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          columnGap: 8,
        }}
      >
        <div
          onClick={() => setColorDirect('#000000')}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#000000',
            border: '1px solid rgba(0,0,0,0.4)',
            cursor: 'pointer',
          }}
        />
        <div
          ref={barRef}
          onMouseDown={onMouseDown}
          style={{
            position: 'relative',
            flex: 1,
            height: 10,
            borderRadius: 6,
            background:
              'linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${(hue / 360) * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: hex,
              border: '1px solid rgba(0,0,0,0.4)',
              pointerEvents: 'none',
            }}
          />
        </div>
        <div
          onClick={() => setColorDirect('#ffffff')}
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#ffffff',
            border: '1px solid rgba(0,0,0,0.4)',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}
