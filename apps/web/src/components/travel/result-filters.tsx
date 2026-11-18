/**
 * The filter rail over a set of results.
 *
 * Every control is a link carrying the whole query with one parameter changed.
 * That is not a stylistic choice: a filtered view of a search is a *view* of
 * rows already fetched, so it must cost no provider call, must have its own URL
 * to share, and must work before any JavaScript has loaded. A client-side store
 * would have failed all three.
 *
 * Each option carries how many fares it would leave. A filter that silently
 * empties a list is a filter a person presses twice and then distrusts; a
 * filter that says "IndiGo (4)" before it is pressed is one they can use.
 * Options that would match nothing are still shown, marked, and not pressable
 * — the absence is information.
 */
import Link from 'next/link';

export interface FilterOption {
  label: string;
  href: string;
  current: boolean;
  /** How many fares this option would leave. Undefined where counting makes no sense. */
  count?: number;
}

export interface FilterGroup {
  legend: string;
  options: FilterOption[];
}

export function FilterRail({ groups, label }: { groups: FilterGroup[]; label: string }) {
  return (
    <nav className="op-filters" aria-label={label}>
      {groups.map((group) => (
        <div className="op-filter-group" key={group.legend} role="group" aria-label={group.legend}>
          <span className="op-filter-legend" aria-hidden="true">
            {group.legend}
          </span>
          {group.options.map((option) =>
            option.count === 0 && !option.current ? (
              <span
                key={option.label}
                className="op-filter"
                style={{ opacity: 0.5 }}
                title={`No fare in these results matches ${option.label.toLowerCase()}`}
              >
                {option.label} <span className="op-filter-count">0</span>
              </span>
            ) : (
              <Link
                key={option.label}
                href={option.href}
                className="op-filter"
                aria-current={option.current ? 'true' : undefined}
              >
                {option.label}
                {option.count !== undefined ? <span className="op-filter-count">{option.count}</span> : null}
              </Link>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
