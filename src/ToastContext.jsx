import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

const ToastContext = createContext(null);

let idCounter = 0;
const nextId = () => ++idCounter;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((message, type = "success", duration = 3000) => {
    const id = nextId();
    setToasts((t) => [...t, { id, message, type }]);
    if (duration > 0) setTimeout(() => remove(id), duration);
  }, [remove]);

  const api = useMemo(
    () => ({
      push,                // toast.push("Saved", "success")
      success: (m, d) => push(m, "success", d ?? 3000),
      error:   (m, d) => push(m, "error",   d ?? 4000),
      info:    (m, d) => push(m, "info",    d ?? 3000),
      remove,
    }),
    [push, remove]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Viewport */}
      <div 
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 9999
      }}>
        {toasts.map(({ id, message, type }) => (
          <div key={id} className={`toast ${type}`}>
            {message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
