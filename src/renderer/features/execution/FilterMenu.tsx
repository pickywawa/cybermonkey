import { ListFilter } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../../shared/i18n';
import { Button, Check } from '../../shared/ui/controls';
import { Menu } from '../../shared/ui/overlays';

export interface FilterOption {
  value: string;
  label: ReactNode;
  count?: number;
}

/** Filters as checkboxes in a drop-down: nothing ticked shows everything, several ticked show their union. */
export function FilterMenu({
  options,
  selected,
  onChange,
}: {
  options: FilterOption[];
  selected: Set<string>;
  onChange(next: Set<string>): void;
}) {
  const t = useT();
  return (
    <Menu
      align="right"
      trigger={(toggle) => (
        <Button size="sm" icon={<ListFilter size={13} />} onClick={toggle}>
          {t('exec.filters')}
          {selected.size > 0 && <span className="badge accent">{selected.size}</span>}
        </Button>
      )}
    >
      {() => (
        <div className="filter-menu">
          {options.map((o) => (
            <Check
              key={o.value}
              checked={selected.has(o.value)}
              onChange={(on) => {
                const next = new Set(selected);
                on ? next.add(o.value) : next.delete(o.value);
                onChange(next);
              }}
            >
              <span className="filter-opt">
                {o.label}
                {o.count !== undefined && <span className="note">{o.count}</span>}
              </span>
            </Check>
          ))}
          <hr />
          <button disabled={!selected.size} onClick={() => onChange(new Set())}>
            {t('exec.filters.reset')}
          </button>
        </div>
      )}
    </Menu>
  );
}
