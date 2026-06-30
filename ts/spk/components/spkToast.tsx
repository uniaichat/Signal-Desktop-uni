// ToastManager.tsx
import React, { useState, useEffect, useCallback } from 'react';

export type ToastItem = {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  duration: number;
};

let addToastExternal: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
let nextToastId = 0;

export function SpkToastManager() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = nextToastId++;
    const newToast = { id, ...t };
    setToasts(prev => [...prev, newToast]);

    setTimeout(() => {
      setToasts(prev => prev.filter(item => item.id !== id));
    }, t.duration || 3000);
  }, []);

  addToastExternal = addToast;

  return (
    <div style={{
      position: 'fixed',
      left: '50%',
      bottom: '50px',
      zIndex: 9999,
      transform: 'translateX(-50%)'
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            color: '#fff',
            padding: '10px 16px',
            marginTop: '10px',
            borderRadius: '6px',
            background: t.type === 'error' ? '#f44336' :
                        t.type === 'success' ? '#4caf50' : '#2196f3',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export const SpkToast = {
  error(message: string, duration = 3000) {
    addToastExternal?.({ type: 'error', message, duration });
  },
  success(message: string, duration = 3000) {
    addToastExternal?.({ type: 'success', message, duration });
  },
  info(message: string, duration = 3000) {
    addToastExternal?.({ type: 'info', message, duration });
  },
};