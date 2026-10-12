import type { CostEstimate, CostLine } from '@aro-planner/common';

const money = (n: number, dp = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Every figure is labelled with where it came from. A price Azure published and a
 * number we assumed must never look the same - that distinction is the whole point
 * of the panel being trustworthy.
 */
function SourceTag({ line }: { line: CostLine }) {
  if (!line.included) return <span className="tag tag-excluded">excluded</span>;
  if (line.source === 'azure-api') return <span className="tag tag-live">live</span>;
  if (line.source === 'override') return <span className="tag tag-override">configured</span>;
  return <span className="tag tag-assumption">assumed</span>;
}

export interface CostPanelProps {
  estimate: CostEstimate | null;
  loading: boolean;
  error?: string | undefined;
  warning?: string | undefined;
  stale: boolean;
  retrievedAt?: string | undefined;
}

export function CostPanel({ estimate, loading, error, warning, stale, retrievedAt }: CostPanelProps) {
  return (
    <aside className="cost-panel" aria-live="polite" aria-busy={loading}>
      <div className="cost-panel-head">
        <h2>Estimated cost</h2>
        {loading && <span className="spinner" aria-label="Updating estimate" />}
      </div>

      {error && (
        <div className="banner banner-error" role="alert">
          <strong>Could not price this.</strong>
          <div>{error}</div>
        </div>
      )}

      {warning && !error && (
        <div className="banner banner-warn" role="status">
          {warning}
        </div>
      )}

      {stale && (
        <div className="banner banner-warn" role="status">
          Azure was unreachable, so these are cached prices
          {retrievedAt ? ` from ${new Date(retrievedAt).toLocaleString()}` : ''}.
        </div>
      )}

      {!estimate && !error && !warning && <p className="muted">Fill in the form to see a price.</p>}

      {estimate && (
        <>
          <div className="headline">
            <div className="headline-figure">${money(estimate.monthly)}</div>
            <div className="headline-unit">per month</div>
            <div className="headline-sub">
              ${money(estimate.hourly, 4)}/hour &middot; ${money(estimate.yearly)}/year
            </div>
          </div>

          <table className="lines">
            <tbody>
              {estimate.lines.map(line => (
                <tr key={line.label} className={line.included ? '' : 'row-excluded'}>
                  <td>
                    <div className="line-label">{line.label}</div>
                    {line.detail && <div className="line-detail">{line.detail}</div>}
                    {line.sourceNote && <div className="line-note">{line.sourceNote}</div>}
                  </td>
                  <td className="line-amount">
                    {line.included ? `$${money(line.hourly, 4)}/hr` : '--'}
                    <div>
                      <SourceTag line={line} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {estimate.assumptions.length > 0 && (
            <div className="assumptions">
              <h3>Before you quote this</h3>
              <ul>
                {estimate.assumptions.map(a => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="muted small">
            {estimate.currency} list price, {estimate.hoursPerMonth} hours/month. No reserved-instance
            or enterprise agreement discounts applied.
          </p>
        </>
      )}
    </aside>
  );
}
