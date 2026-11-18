/**
 * One endpoint, rendered from the catalogue.
 *
 * A server component. The only things on these pages that need the browser are
 * copying and the live call, and both are their own small client components —
 * so an endpoint reference arrives as HTML, is readable with JavaScript off,
 * and is indexable.
 *
 * The layout puts prose and parameters on the left and the actual exchange on
 * the right, because those are the two questions a reader alternates between:
 * "what do I send" and "what comes back". On a narrow screen it stacks, prose
 * first — reading order is the fallback and it should be the sensible one.
 */
import type { ReactNode } from 'react';
import {
  AUTH_MODE,
  METHOD_TONE,
  type Endpoint,
  type Param,
} from '@/lib/api-catalog';
import { LIMITS } from '@/lib/ratelimit';
import { Code } from './code';
import { TryVerify } from './try-it';

/** A method as a fixed-width block, so a column of them reads as a column. */
export function Method({ method }: { method: Endpoint['method'] }) {
  return <span className={`method ${METHOD_TONE[method]}`}>{method}</span>;
}

/**
 * A path with its parameters picked out.
 *
 * `{orgId}` in a different colour is the difference between a reader seeing a
 * template and a reader copying a literal brace into their code.
 */
export function Path({ path }: { path: string }) {
  const parts = path.split(/(\{\w+\})/g).filter(Boolean);
  return (
    <span className="sig-path">
      {parts.map((part, i) =>
        part.startsWith('{') ? (
          <span key={i} className="slot">
            {part}
          </span>
        ) : (
          // A `<wbr>` after every slash. Without it a long path is one
          // unbreakable word, and the browser's only options are to overflow the
          // column or to break mid-segment — which is how
          // `/credentials/{id}/revoke` rendered as `…/revok` + `e`. This gives
          // the line a legal place to break that a reader would also have
          // chosen.
          <span key={i}>
            {part.split('/').map((segment, j, all) => (
              <span key={j}>
                {segment}
                {j < all.length - 1 ? (
                  <>
                    /<wbr />
                  </>
                ) : null}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}

export function Signature({ endpoint }: { endpoint: Endpoint }) {
  return (
    <span className="sig">
      <Method method={endpoint.method} />
      <Path path={endpoint.path} />
    </span>
  );
}

function ParamTable({ params, title }: { params: Param[]; title: string }) {
  if (params.length === 0) return null;
  return (
    <div className="stack stack-2">
      <h4 className="eyebrow">{title}</h4>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={`${p.where}:${p.name}`}>
                <td>
                  <span className="param-name">
                    {p.name}
                    {/* Required is a mark on the name rather than a column: a
                        whole column reading "no" is a column of nothing. */}
                    {p.required ? (
                      <abbr className="param-req" title="Required">
                        *
                      </abbr>
                    ) : null}
                  </span>
                </td>
                <td>
                  <span className="param-type">{p.type}</span>
                </td>
                <td>
                  {p.about}
                  {p.constraint ? (
                    <>
                      {' '}
                      <span className="param-where">{p.constraint}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** `curl` for this endpoint, generated rather than written out by hand. */
function curlFor(endpoint: Endpoint, host: string): string {
  const url = `${host}${endpoint.path}`;
  const lines: string[] = [];

  if (endpoint.method === 'GET') {
    lines.push(`curl ${url}`);
  } else {
    lines.push(`curl -X ${endpoint.method} ${url} \\`);
  }

  if (endpoint.request) {
    lines.push(`  -H 'content-type: application/json' \\`);
  }
  if (endpoint.auth === 'open-or-key') {
    lines.push(`  -H 'authorization: Bearer op_live_...' \\`);
  }
  if (endpoint.auth === 'session' || endpoint.auth === 'session-write') {
    lines.push(`  -H 'cookie: onepass_session=...' \\`);
  }
  if (endpoint.auth === 'session-write') {
    lines.push(`  -H 'origin: ${host}' \\`);
  }
  if (endpoint.request) {
    // One line, so the example pastes into a terminal and runs.
    lines.push(`  -d '${endpoint.request.replace(/\s*\n\s*/g, ' ')}'`);
  }

  // Tidy the trailing continuation off whichever line ended up last.
  const last = lines.length - 1;
  lines[last] = lines[last]!.replace(/ \\$/, '');
  return lines.join('\n');
}

export function EndpointBlock({
  endpoint,
  host,
  sampleReference,
}: {
  endpoint: Endpoint;
  host: string;
  /** A reference that exists on this deployment, for the live call. */
  sampleReference?: string;
}) {
  const auth = AUTH_MODE[endpoint.auth];
  const limit = endpoint.rateLimit ? LIMITS[endpoint.rateLimit] : null;

  const pathParams = endpoint.params.filter((p) => p.where === 'path');
  const queryParams = endpoint.params.filter((p) => p.where === 'query');
  const bodyParams = endpoint.params.filter((p) => p.where === 'body');
  const headerParams = endpoint.params.filter((p) => p.where === 'header');

  return (
    <article id={endpoint.id} className="card stack stack-5 endpoint">
      <header className="stack stack-3">
        <div className="endpoint-head">
          <Signature endpoint={endpoint} />
          <span className={`chip chip-${auth.tone}`} title={auth.detail}>
            {auth.label}
          </span>
          {limit ? (
            <span className="chip chip-soon" title={`Policy: ${endpoint.rateLimit}`}>
              {limit.limit}/{limit.windowSeconds === 60 ? 'min' : `${limit.windowSeconds}s`}
            </span>
          ) : null}
        </div>
        <h3 className="h3 anchored">{endpoint.title}</h3>
        <p className="muted">{endpoint.summary}</p>
      </header>

      <div className="endpoint-body">
        {/* ── what you send ── */}
        <div className="stack stack-4">
          <div className="stack stack-2">
            <h4 className="eyebrow">Authentication</h4>
            <p className="muted" style={{ fontSize: 13.5 }}>
              {auth.detail}
            </p>
            {endpoint.permission ? (
              <p className="muted" style={{ fontSize: 13.5 }}>
                Requires <span className="mono">{endpoint.permission}</span> on the organization in
                the path.
              </p>
            ) : null}
            {endpoint.scope && endpoint.auth !== 'open-or-key' ? (
              <p className="muted" style={{ fontSize: 13.5 }}>
                Granted to keys as <span className="mono">{endpoint.scope}</span>, which does not yet
                authenticate this route.
              </p>
            ) : null}
          </div>

          <ParamTable params={pathParams} title="Path" />
          <ParamTable params={queryParams} title="Query" />
          <ParamTable params={bodyParams} title="Body" />
          <ParamTable params={headerParams} title="Headers" />

          {endpoint.notes && endpoint.notes.length > 0 ? (
            <div className="stack stack-2">
              <h4 className="eyebrow">Worth knowing</h4>
              <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
                {endpoint.notes.map((note) => (
                  <li key={note} className="muted" style={{ fontSize: 13.5 }}>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* ── what happens ── */}
        <div className="stack stack-4">
          <Code language="plain" label="Copy curl" title="Request">
            {curlFor(endpoint, host)}
          </Code>

          {endpoint.request ? <Code title="Body">{endpoint.request}</Code> : null}

          <Code title={`Response · ${endpoint.response.status}`}>{endpoint.response.body}</Code>

          {endpoint.errors.length > 0 ? (
            <div className="stack stack-2">
              <h4 className="eyebrow">Can also return</h4>
              <p className="row-wrap" style={{ gap: 6 }}>
                {endpoint.errors.map((code) => (
                  <a key={code} className="chip chip-soon mono" href={`/developers/errors#${code}`}>
                    {code}
                  </a>
                ))}
              </p>
            </div>
          ) : null}

          {endpoint.tryIt ? (
            <div className="stack stack-2">
              <h4 className="eyebrow">Try it</h4>
              <TryVerify sample={sampleReference ?? 'cred_8ej1g185p9'} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** A compact row for the index at the top of the reference. */
export function EndpointRow({ endpoint, children }: { endpoint: Endpoint; children?: ReactNode }) {
  return (
    <tr>
      <td>
        <Method method={endpoint.method} />
      </td>
      <td>
        <a href={`#${endpoint.id}`} className="sig-path">
          {endpoint.path}
        </a>
      </td>
      <td>{children ?? endpoint.title}</td>
    </tr>
  );
}
