/**
 * The design playground.
 *
 * The reference for how ONEPASS looks, built entirely from the components the
 * product itself renders — so it cannot drift into a showcase of things no
 * screen uses. If a specimen here looks wrong, the product looks wrong.
 *
 * Internal: open in development, and in production only to platform staff.
 * Never indexed.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  Badge,
  Button,
  Card,
  CardHead,
  DefinitionList,
  Empty,
  Field,
  Meter,
  Money,
  Monogram,
  Notice,
  PageHead,
  Stat,
  StatRow,
  StatusBadge,
  Steps,
  Brand,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { ErrorState, LoadingState, OfflineState, SectionHead, StatusChip } from '@/components/system';
import { Certificate, Guilloche, Pass, Poster, Receipt, Ticket } from '@/components/objects';
import { ObjectLight } from '@/components/system/object-light';
import { ThemeToggle } from '@/components/system/theme-toggle';
import { THEME_COOKIE, parseTheme } from '@/components/system/theme';
import { QrSvg } from '@/components/consumer/qr';
import { getActor } from '@/lib/authz/authorize';
import { BRAND } from '@/lib/brand';
import { DialogDemo, Replay } from './demo';

export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false, follow: false },
};

const SWATCHES = [
  ['--ground', 'Ground'],
  ['--surface', 'Surface'],
  ['--raised', 'Raised'],
  ['--sunken', 'Sunken'],
  ['--ink', 'Ink'],
  ['--ink-2', 'Ink 2'],
  ['--muted', 'Muted'],
  ['--line', 'Line'],
  ['--accent', 'Jade · action'],
  ['--value', 'Marigold · value'],
  ['--ok', 'OK'],
  ['--warn', 'Warn'],
  ['--bad', 'Vermilion · danger'],
  ['--info', 'Indigo · information'],
  ['--offline', 'Offline'],
] as const;

const STOCK = [
  ['--stock-jade-b', 'Pass stock'],
  ['--stock-paper', 'Ticket paper'],
  ['--stock-indigo', 'Boarding band'],
  ['--stock-vermilion', 'Event band'],
  ['--stock-marigold', 'City band'],
  ['--stock-ink', 'Credential band'],
] as const;

function Specimen({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="stack stack-4 ds-section" aria-labelledby={`${id}-h`}>
      <div className="stack stack-1">
        <h2 id={`${id}-h`} className="h2">
          {title}
        </h2>
        {note ? <p className="small muted" style={{ maxWidth: '72ch' }}>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function DesignPlayground() {
  const actor = await getActor();
  if (process.env.NODE_ENV === 'production' && !actor?.isPlatformStaff) notFound();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="shell" data-surface="consumer">
      <div className="ambient" aria-hidden="true" />
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand href="/" subtitle="Design" />
          <ThemeToggle initial={theme} compact />
        </div>
      </header>
      <main id="main" className="wrap stack stack-8 app-main">
        <PageHead
          eyebrow="Intaglio · the visual language"
          title="The system, specimen by specimen"
          lede="Paper and ink for the room; printed stock for the things a person carries. Jade is the brand and the action, marigold is value, vermilion is danger, indigo is information. Nothing is coloured for decoration."
        />

        <nav aria-label="Specimens" className="row-wrap">
          {['type', 'colour', 'actions', 'forms', 'status', 'surfaces', 'objects', 'states', 'motion'].map((s) => (
            <a key={s} className="chip chip-soon" href={`#${s}`}>
              {s}
            </a>
          ))}
        </nav>

        <Specimen id="type" title="Type" note="Archivo, variable in width and weight, for display, figures and ticket labels. IBM Plex Sans for reading; Plex Mono for references and code.">
          <div className="stack stack-4">
            <p className="display hero">Show once. Belong everywhere.</p>
            <p className="display h1">Display, expanded — H1</p>
            <p className="h2">Wide — H2 section title</p>
            <p className="h3">Normal — H3 card title</p>
            <p className="lede">Lede: the sentence under a title, set larger and quieter, that says what the page is for.</p>
            <p>Body copy in Plex Sans. It is set at 15–16px with a 1.6 line height, measured for reading on a phone held at arm&rsquo;s length.</p>
            <p className="eyebrow">Eyebrow · condensed caps</p>
            <div className="row-wrap" style={{ gap: 32, alignItems: 'baseline' }}>
              <span className="figure-lg"><Money minor={1234550} /></span>
              <span className="figure"><Money minor={14900} /></span>
              <span className="num">1,284</span>
              <span className="mono">px_4k82ndv1 · BKG-7Q2M</span>
            </div>
          </div>
        </Specimen>

        <Specimen id="colour" title="Colour" note="Semantic tokens, designed separately for light and dark. The object stock below does not change with the theme.">
          <div className="ds-swatches">
            {SWATCHES.map(([token, label]) => (
              <div key={token} className="ds-swatch">
                <span style={{ background: `var(${token})` }} />
                <p className="small">{label}</p>
                <p className="tiny muted mono">{token}</p>
              </div>
            ))}
          </div>
          <div className="ds-swatches">
            {STOCK.map(([token, label]) => (
              <div key={token} className="ds-swatch">
                <span style={{ background: `var(${token})` }} />
                <p className="small">{label}</p>
                <p className="tiny muted mono">{token}</p>
              </div>
            ))}
          </div>
        </Specimen>

        <Specimen id="actions" title="Actions">
          <div className="row-wrap">
            <Button variant="primary">Primary</Button>
            <Button>Default</Button>
            <Button variant="value">Value</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
            <Button variant="primary" size="lg">
              Book this seat <span className="arrow" aria-hidden="true">→</span>
            </Button>
            <Button size="sm">Small</Button>
          </div>
          <div className="row-wrap">
            <div className="segmented" role="group" aria-label="Example segmented control">
              <button type="button" className="segment" aria-pressed="true">Upcoming</button>
              <button type="button" className="segment" aria-pressed="false">Past</button>
              <button type="button" className="segment" aria-pressed="false">Cancelled</button>
            </div>
            <DialogDemo />
          </div>
          <nav className="tabs" aria-label="Example tabs">
            <a className="tab" href="#actions" aria-current="page">Overview <span className="count">4</span></a>
            <a className="tab" href="#actions">Routes</a>
            <a className="tab" href="#actions">Airlines</a>
          </nav>
        </Specimen>

        <Specimen id="forms" title="Forms" note="16px inputs so iOS does not zoom; the error is text, not only colour.">
          <div className="grid grid-2">
            <Field label="Email" htmlFor="ds-email" hint="We send a six-digit code, never a link.">
              <input id="ds-email" className="input" type="email" placeholder="you@example.in" />
            </Field>
            <Field label="Code" htmlFor="ds-code" error="That code has expired. Ask for another.">
              <input id="ds-code" className="input input-mono" aria-invalid="true" defaultValue="482913" />
            </Field>
            <Field label="City" htmlFor="ds-city">
              <select id="ds-city" className="select" defaultValue="pune">
                <option value="pune">Pune</option>
                <option value="mumbai">Mumbai</option>
              </select>
            </Field>
            <Field label="Note" htmlFor="ds-note">
              <textarea id="ds-note" className="textarea" placeholder="Anything the venue should know" />
            </Field>
          </div>
          <label className="switch">
            <input type="checkbox" defaultChecked />
            <span className="switch-track" aria-hidden="true" />
            <span className="small">Email me when a warranty is about to end</span>
          </label>
        </Specimen>

        <Specimen id="status" title="Status" note="A status is a stamp — condensed caps in a tight box. Feature status comes from the registry; NEEDS_CONFIG is dashed: built, waiting on something outside the code.">
          <div className="row-wrap">
            {['CONFIRMED', 'HELD', 'CANCELLED', 'FAILED', 'REFUNDED', 'ADMITTED', 'PENDING_REVIEW'].map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <div className="row-wrap">
            <StatusChip status="LIVE" />
            <StatusChip status="BETA" />
            <StatusChip status="PILOT" />
            <StatusChip status="NEEDS_CONFIG" />
            <StatusChip status="PLANNED" />
            <Badge tone="value">Value</Badge>
            <span className="badge badge-offline">Offline</span>
          </div>
          <div className="stack stack-2">
            <Notice tone="ok">Payment captured by the provider. Your ticket is issued.</Notice>
            <Notice tone="warn">Processing — the provider has not confirmed yet. Nothing has been charged twice.</Notice>
            <Notice tone="bad">The provider declined the payment. You have not been charged.</Notice>
            <Notice tone="info">Fares are from the sample source in development and cannot be booked.</Notice>
          </div>
          <Steps
            label="Booking progress"
            steps={[
              { label: 'Selected', state: 'done' },
              { label: 'Reviewed', state: 'done' },
              { label: 'Payment', state: 'current', detail: 'Waiting for the provider' },
              { label: 'Confirmed', state: 'todo' },
            ]}
          />
          <div style={{ maxWidth: 360 }} className="stack stack-2">
            <Meter value={62} max={100} label="Warranty used" />
            <Meter value={80} max={100} label="Seats sold" tone="value" />
          </div>
        </Specimen>

        <Specimen id="surfaces" title="Surfaces" note="Cards are sheets of stock on a desk: a hairline, a lit top edge, barely any shadow. Glass is vellum, and only for what floats.">
          <StatRow>
            <Stat label="Saved this month" value={<Money minor={20200} />} hint="Across 3 partners" tone="value" />
            <Stat label="Points" value="1,284" hint="Worth about ₹128" />
            <Stat label="Open returns" value="1" tone="warn" />
            <Stat label="Failed webhooks" value="0" tone="ok" />
          </StatRow>
          <div className="grid grid-3">
            <Card>
              <CardHead title="A card" action={<a href="#surfaces" className="small">Action</a>} />
              <DefinitionList items={[["Merchant", 'Phoenix Cinemas'], ['Amount', <Money key="m" minor={29800} />], ['Status', <StatusBadge key="s" status="CAPTURED" />]]} />
            </Card>
            <div className="glass" style={{ padding: 20 }}>
              <p className="h3">Glass</p>
              <p className="small muted">Floating layers only: the bar, the dock, the palette, a sheet.</p>
            </div>
            <div className="immersive card" style={{ border: 0 }}>
              <Guilloche pattern="field" />
              <p className="h3" style={{ position: 'relative' }}>Immersive</p>
              <p className="small muted" style={{ position: 'relative' }}>A stage for a story — the landing hero, the travel header, a verdict.</p>
            </div>
          </div>
          <div className="row-wrap">
            <Monogram name="Phoenix Cinemas" />
            <Monogram name="Grand Sahyadri" tone="value" />
            <Monogram name="Meera Kulkarni" tone="info" />
            <Glyph name="pass" /><Glyph name="ticket" /><Glyph name="receipt" /><Glyph name="travel" /><Glyph name="shield" /><Glyph name="wallet" />
          </div>
        </Specimen>

        <Specimen id="objects" title="Objects" note="The things a person carries are printed stock, not interface. They keep their material in both themes; every decorative layer is aria-hidden.">
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <ObjectLight>
              <Pass seed="px_4k82ndv1" label={`${BRAND.name} pass for Meera Kulkarni`}>
                <Pass.Top status="Active" />
                <Pass.Chip />
                <Pass.Holder name="Meera Kulkarni" reference="px_4k82ndv1" meta="Holder" />
              </Pass>
            </ObjectLight>
            <div className="pass-open">
              <Guilloche seed="px_4k82ndv1" />
              <Pass.Top status="Live code" />
              <div className="pass-plate" style={{ display: 'grid', placeItems: 'center' }}>
                <QrSvg text="specimen-not-a-real-code" size={180} title="Specimen code — not a real pass" />
              </div>
              <p className="pass-meta">Rotates in 00:18 · show at the reader</p>
            </div>
          </div>

          <div className="stack stack-4">
            <Ticket kind="boarding" state="valid" label="Boarding pass, Pune to Delhi">
              <Ticket.Main>
                <Ticket.Band label="Boarding pass" right="6E 5234" />
                <Ticket.Route from="PNQ" to="DEL" fromCity="Pune" toCity="Delhi" />
                <Ticket.Fields items={[{ label: 'Date', value: 'Fri 9 Oct' }, { label: 'Departs', value: '06:40' }, { label: 'Passenger', value: 'Meera Kulkarni' }, { label: 'PNR', value: 'Q7M2KD', mono: true }]} />
              </Ticket.Main>
              <Ticket.Stub>
                <Ticket.Stamp tone="info">Sample</Ticket.Stamp>
                <span className="ticket-label">Gate at check-in</span>
              </Ticket.Stub>
            </Ticket>
            <Ticket kind="event" state="valid" label="Event ticket">
              <Ticket.Main>
                <Ticket.Band label="Event ticket" right="Screen 2" />
                <Ticket.Title>Phoenix Cinemas — Viman Nagar</Ticket.Title>
                <Ticket.Fields items={[{ label: 'Show', value: 'Tonight 19:00' }, { label: 'Seats', value: '2' }, { label: 'Ref', value: 'TKT-8QX2', mono: true }]} />
              </Ticket.Main>
              <Ticket.Stub>
                <Ticket.Stamp tone="ok">Valid</Ticket.Stamp>
              </Ticket.Stub>
            </Ticket>
            <Ticket kind="city" state="used" label="City pass, used">
              <Ticket.Main>
                <Ticket.Band label="City pass" />
                <Ticket.Title>Pune — 3 attractions</Ticket.Title>
              </Ticket.Main>
              <Ticket.Stub>
                <Ticket.Stamp tone="neutral">Used</Ticket.Stamp>
              </Ticket.Stub>
            </Ticket>
          </div>

          <div className="grid grid-3" style={{ alignItems: 'start' }}>
            <Receipt label="Receipt specimen">
              <Receipt.Head merchant="Sahyadri Kitchen">
                <span className="receipt-muted">Koregaon Park · 12 Sep, 20:14</span>
              </Receipt.Head>
              <Receipt.Lines>
                <Receipt.Line label="Tasting menu × 2" value="₹2,400" />
                <Receipt.Line label="GST 5%" value="₹120" muted />
              </Receipt.Lines>
              <Receipt.Total value="₹2,520" />
            </Receipt>
            <Certificate seed="warranty-kettle">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Certificate.Seal />
                <div className="stack stack-1">
                  <p className="eyebrow">Warranty</p>
                  <p className="h3">Travel kettle 1.2L</p>
                  <p className="small muted">Covered until 6 Sep · 24 months</p>
                </div>
              </div>
            </Certificate>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <Poster kind="CINEMA" seed="Phoenix Cinemas" city="Pune" />
              <div style={{ padding: 16 }}>
                <p className="h4">Phoenix Cinemas</p>
                <p className="small muted">A drawn poster — never a photograph we do not have.</p>
              </div>
            </div>
          </div>
        </Specimen>

        <Specimen id="states" title="States" note="Every screen has all of them: loading, empty, error, offline — and says NEEDS_CONFIG when the gap is a credential, not code.">
          <div className="grid grid-2">
            <Card><LoadingState label="Loading receipts" /></Card>
            <Card><Empty title="No tickets yet" body="A ticket appears here the moment a booking is confirmed." action={<a className="btn btn-sm" href="#states">Find something tonight</a>} /></Card>
            <ErrorState requestId="req_01J8X9Q2" />
            <OfflineState works={['Tickets you opened while online', 'This page, once loaded']} />
          </div>
          <Notice tone="warn">
            <span>
              <span className="chip chip-config">Needs setup</span> Live flight fares need <code>AMADEUS_CLIENT_ID</code> and{' '}
              <code>AMADEUS_CLIENT_SECRET</code>. Until then this screen says so rather than inventing a fare.
            </span>
          </Notice>
        </Specimen>

        <Specimen id="motion" title="Motion" note="Four durations, three curves, and a spring for things with mass. Under reduced motion everything below arrives instantly and still reads.">
          <SectionHead eyebrow="Entrances" title="Rise, land, stagger" />
          <div className="grid grid-3">
            <Replay className="rise"><Card><p className="h4">Rise</p><p className="small muted">Content arriving: 380ms, ease-out.</p></Card></Replay>
            <Replay className="land"><Card><p className="h4">Land</p><p className="small muted">An object arriving, with a little mass.</p></Card></Replay>
            <Replay className="stagger stack stack-2">
              <Card><p className="small">First</p></Card>
              <Card><p className="small">Second</p></Card>
              <Card><p className="small">Third</p></Card>
            </Replay>
          </div>
        </Specimen>
      </main>
    </div>
  );
}
