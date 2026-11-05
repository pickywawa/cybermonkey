import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconButton } from './controls';

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'default',
  icon,
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'default' | 'wide' | 'narrow';
  icon?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className={`modal ${size === 'default' ? '' : size}`} role="dialog" aria-modal="true">
        <header>
          {icon}
          <h2>{title}</h2>
          {onClose && (
            <IconButton label="Close" onClick={onClose}>
              <X size={16} />
            </IconButton>
          )}
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** Dropdown anchored to its trigger; closes on outside click or Escape. */
export function Menu({
  trigger,
  children,
  align = 'left',
  up = false,
}: {
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  /** Open above the trigger (for controls at the bottom of a panel). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => (
      window.removeEventListener('mousedown', down),
      window.removeEventListener('keydown', key)
    );
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div
          className="popover"
          style={{ [up ? 'bottom' : 'top']: 'calc(100% + 4px)', [align]: 0 }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface Toast {
  id: number;
  tone: 'info' | 'ok' | 'err';
  text: ReactNode;
}
const ToastContext = createContext<(text: ReactNode, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'err' ? 9000 : 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'info' ? '' : t.tone}`}>
            <div className="grow">{t.text}</div>
            <IconButton
              label="Close"
              onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
