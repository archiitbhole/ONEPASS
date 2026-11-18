/**
 * Console furniture: the page header, the organization switcher and the
 * small primitives the partner screens repeat.
 *
 * Server components throughout — none of this needs a browser. The switcher in
 * particular is a plain `<select>` inside a form whose action is a server
 * function: it navigates with no client JavaScript at all, which matters because
 * a switcher that only works once React has hydrated is a switcher that strands
 * someone on the wrong tenant on a bad connection.
 */
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // `.console-head` rather than inline spacing: every console page assembled
    // this by hand and the gaps drifted by a few pixels per screen. The hairline
    // underneath is what makes the head read as separate from the content
    // rather than as its first paragraph.
    <header className="console-head">
      <div className="console-head-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      {actions ? <div className="row-wrap">{actions}</div> : null}
    </header>
  );
}

export interface SwitchableOrg {
  organizationId: string;
  organizationName: string;
}

/**
 * The tenant switcher.
 *
 * Only rendered when the actor genuinely belongs to more than one organization —
 * a control that offers one option is furniture, not a control. The action
 * re-checks membership before it redirects; the select is a suggestion from the
 * browser, not an authorization.
 */
export function OrgSwitcher({
  current,
  organizations,
  action,
}: {
  current: string;
  organizations: SwitchableOrg[];
  action: (formData: FormData) => Promise<void>;
}) {
  if (organizations.length < 2) return null;

  return (
    <form action={action} className="org-switcher">
      <label className="sr-only" htmlFor="org-switcher">
        Organization
      </label>
      <select
        id="org-switcher"
        name="organizationId"
        className="select"
        defaultValue={current}
      >
        {organizations.map((org) => (
          <option key={org.organizationId} value={org.organizationId}>
            {org.organizationName}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-sm">
        Switch
      </button>
    </form>
  );
}

/**
 * A filter strip built from links rather than a form.
 *
 * URL params are the state, so a filtered view is shareable, bookmarkable and
 * survives a reload — which is what an operations screen is for. No JavaScript.
 */
export function FilterLinks({
  options,
  current,
  label,
}: {
  options: { href: string; label: string; value: string | null }[];
  current: string | null;
  label: string;
}) {
  return (
    // A segmented control rather than a row of buttons: these options are one
    // choice with one answer, and a row of primary-coloured buttons reads as a
    // row of actions — six things to do rather than six views of one list.
    <div className="segmented segmented-sm" role="group" aria-label={label}>
      {options.map((option) => {
        const active = (option.value ?? null) === current;
        return (
          <a
            key={option.label}
            href={option.href}
            className="segment"
            aria-current={active ? 'page' : undefined}
          >
            {option.label}
          </a>
        );
      })}
    </div>
  );
}

/** A short label/value pair for the dense header strips above a table. */
export function Summary({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="summary-strip">
      {items.map((item) => (
        <div key={item.label}>
          <p className="eyebrow">{item.label}</p>
          <p className="summary-value">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The consent reminder that appears anywhere a person could be inferred.
 *
 * It is on the page rather than in a doc because the rule it states is the one a
 * partner is most likely to assume away: a booking reference is not a customer.
 */
export function ConsentNote({ children }: { children: ReactNode }) {
  return (
    <p className="consent-note tiny muted">
      <Badge tone="neutral">Consent</Badge>
      <span>{children}</span>
    </p>
  );
}
