/**
 * The working, shown.
 *
 * Every computed statement in this console carries the figures it was derived
 * from — `evidence` on a merchant insight, the sample and spread behind a demand
 * estimate. This renders that object as a table a merchant can read and, more to
 * the point, can check against their own query.
 *
 * The formatting is driven by the key's suffix rather than by a per-detector
 * mapping, so a detector added tomorrow renders correctly without touching this
 * file: `…Minor` is paise, `…Pct` is a percentage, `…Bp` is basis points. A key
 * with no suffix is printed as it is stored — never rounded, never rescaled,
 * because a figure nobody can reconcile is worse than no figure.
 */
import { TableScroll, formatMoney } from '@/components/ui';

/** `weakestDayMeanMinor` → `Weakest day mean`. */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b(minor|pct|bp)\b$/, '')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The stored value, formatted for its unit and never for its impressiveness. */
export function formatEvidenceValue(key: string, value: number | string): string {
  if (typeof value === 'string') return value;
  if (key.endsWith('Minor')) return formatMoney(value);
  if (key.endsWith('Pct')) return `${value}%`;
  if (key.endsWith('Bp')) return `${(value / 100).toFixed(2)}%`;
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

/**
 * The evidence object as a two-column table.
 *
 * Keys are shown in their stored order — the order the detector wrote them in,
 * which is the order its arithmetic runs.
 */
export function EvidenceTable({
  evidence,
  caption,
}: {
  evidence: Record<string, number | string>;
  caption?: string;
}) {
  const entries = Object.entries(evidence);
  if (entries.length === 0) {
    return <p className="tiny muted">This finding recorded no evidence, which is itself a defect — treat it as unverified.</p>;
  }

  return (
    <TableScroll>
      <table className="table">
        {caption ? <caption className="tiny muted" style={{ captionSide: 'top', textAlign: 'left', paddingBottom: 8 }}>{caption}</caption> : null}
        <thead>
          <tr>
            <th scope="col">Figure</th>
            <th scope="col" className="table-num">Value</th>
            <th scope="col">Stored as</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td>{humaniseKey(key)}</td>
              <td className="table-num">{formatEvidenceValue(key, value)}</td>
              <td className="tiny muted mono">
                {key} = {String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/**
 * The provenance strip under a computed statement.
 *
 * `method` names the arithmetic, `sampleSize` says how much it had to work with.
 * Both are shown next to the claim rather than in a tooltip, because a claim and
 * its confidence belong in the same glance.
 */
export function MethodLine({
  method,
  sampleSize,
  sampleNoun = 'records',
  extra,
}: {
  method: string;
  sampleSize: number;
  sampleNoun?: string;
  extra?: string;
}) {
  return (
    <p className="tiny muted mono" style={{ marginTop: 0 }}>
      method: {method} · sample: {sampleSize} {sampleNoun}
      {extra ? ` · ${extra}` : ''}
    </p>
  );
}
