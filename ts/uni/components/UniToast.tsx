// ToastManager.tsx
import React, { useState, useEffect } from 'react';

export type ToastItem = {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  duration: number;
};

let addToastExternal: (t: Omit<ToastItem, 'id'>) => void;

export function UniToastManager() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    const newToast = { id, ...t };
    setToasts(prev => [...prev, newToast]);

    // 自动移除
    setTimeout(() => {
     delTosts(id)
    }, t.duration || 3000);
  };
  const delTosts = (id:any) =>{
      setToasts(prev => prev.filter(t => t.id !== id))
  }

  // 暴露给外部的全局方法
  addToastExternal = addToast;

  return (
    <div style={{
      position: 'fixed',
      left: '50%',
      bottom: '50px',
      zIndex: 9999,
      transform:' translateX(-50%)'
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={()=> delTosts(t.id)}
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

// 对外暴露全局 toast 对象
export const UniToast = {
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
