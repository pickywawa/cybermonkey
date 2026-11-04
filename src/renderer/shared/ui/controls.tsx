import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  size?: 'sm' | 'md';
  busy?: boolean;
  icon?: ReactNode;
};
export function Button({
  variant = 'default',
  size = 'md',
  busy,
  icon,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`btn ${variant === 'default' ? '' : variant} ${size === 'sm' ? 'sm' : ''} ${className}`}
    >
      {busy ? <LoaderCircle size={14} className="spin" /> : icon}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  on,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; on?: boolean }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={`icon-btn ${on ? 'on' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export const Field = ({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <div className="field">
    <label>{label}</label>
    {children}
    {hint && <span className="note">{hint}</span>}
  </div>
);
export const Check = ({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) => (
  <label className="check">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>{children}</span>
  </label>
);
export const Badge = ({
  tone,
  children,
  title,
}: {
  tone?: 'ok' | 'err' | 'warn' | 'accent';
  children: ReactNode;
  title?: string;
}) => (
  <span className={`badge ${tone ?? ''}`} title={title}>
    {children}
  </span>
);
export const Spinner = ({ size = 14 }: { size?: number }) => (
  <LoaderCircle size={size} className="spin" />
);
export function ProgressRing({
  percent,
  size = 56,
  stroke = 5,
}: {
  percent: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--hover)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, percent) / 100)}
        />
      </svg>
      <span>{percent}%</span>
    </span>
  );
}
/** Stacked bar: passed / failed / remaining. */
export const Progress = ({
  passed,
  failed,
  total,
}: {
  passed: number;
  failed: number;
  total: number;
}) => (
  <div className="progress" title={`${passed}/${total}`}>
    <i className="p" style={{ width: `${total ? (passed / total) * 100 : 0}%` }} />
    <i className="f" style={{ width: `${total ? (failed / total) * 100 : 0}%` }} />
  </div>
);
