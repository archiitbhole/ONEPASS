/**
 * The flight search form.
 *
 * A plain `<form method="get">`. No JavaScript is required to search: the fields
 * become query parameters, the results page reads them and runs the search on
 * the server. That is not nostalgia — it means the search works on a slow phone
 * before the bundle has loaded, the results have a URL that can be shared and
 * reopened, and the back button does what a person expects.
 *
 * The one client-side behaviour is the trip-kind switch, which shows and hides
 * the return date. It is a radio group and a little CSS rather than state, so it
 * works identically before hydration.
 *
 * **Why a `datalist` rather than a combo box.** The airport list is a few dozen
 * entries shipped with the page. A native `datalist` gives filtering, keyboard
 * navigation and screen-reader support from the browser, for free and correctly;
 * a hand-built dropdown gives all three badly, and is the single most common
 * place an otherwise accessible form falls over.
 *
 * The styles live in `styles/surfaces/travel.css`. They used to be a string
 * exported from here and injected by each of the three pages that render this,
 * which meant the same sheet travelled inside every travel document.
 */
import { Field } from '@/components/ui';
import type { AirportOption } from '@/app/(app)/travel/_queries';
import { dateInput } from './format';

export interface SearchFormValues {
  origin: string;
  destination: string;
  departOn: string;
  returnOn: string;
  tripKind: 'ONE_WAY' | 'RETURN' | 'MULTI_CITY';
  cabin: string;
  adults: number;
  children: number;
  infants: number;
  directOnly: boolean;
  flexDays: number;
}

export function defaultSearchValues(): SearchFormValues {
  const today = new Date();
  return {
    origin: '',
    destination: '',
    // A fortnight out: far enough that there are fares to show, near enough that
    // it is a date somebody might actually fly.
    departOn: dateInput(new Date(today.getTime() + 14 * 86_400_000)),
    returnOn: dateInput(new Date(today.getTime() + 18 * 86_400_000)),
    tripKind: 'ONE_WAY',
    cabin: 'ECONOMY',
    adults: 1,
    children: 0,
    infants: 0,
    directOnly: false,
    flexDays: 0,
  };
}

export function SearchForm({
  airports,
  values,
  action = '/travel/flights/results',
  /** The submit button's words. The hub and the results page ask differently. */
  submitLabel = 'Search flights',
  /** Rendered under the button — where a page says what a search will reach. */
  footnote,
}: {
  airports: AirportOption[];
  values: SearchFormValues;
  action?: string;
  submitLabel?: string;
  footnote?: React.ReactNode;
}) {
  const today = dateInput(new Date());
  const maxDate = dateInput(new Date(Date.now() + 360 * 86_400_000));

  return (
    <form method="get" action={action} className="op-search stack stack-4">
      <datalist id="op-airports">
        {airports.map((airport) => (
          // The value is the code because that is what the server validates, and
          // the label is what a person recognises. A browser shows both.
          <option key={airport.code} value={airport.code} label={`${airport.city} — ${airport.name}`} />
        ))}
      </datalist>

      <fieldset className="op-trip-kind">
        <legend className="sr-only">Trip type</legend>
        {(
          [
            ['ONE_WAY', 'One way'],
            ['RETURN', 'Return'],
            ['MULTI_CITY', 'Multi-city'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="op-trip-option">
            {/*
              Invisible, but the same size as the chip it controls.
              `.sr-only` would have made this a 1px control: correct for a screen
              reader, and a 1×1 target for anybody using a pointer or being
              measured against WCAG 2.5.8. Stretching it over the label gives it
              the 36px hit area the chip already looks like it has.
            */}
            <input type="radio" name="trip" value={value} defaultChecked={values.tripKind === value} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <div className="op-search-grid">
        <Field label="From" htmlFor="origin" hint="Airport code, or start typing a city">
          <input
            id="origin"
            name="from"
            list="op-airports"
            className="input"
            defaultValue={values.origin}
            placeholder="DEL"
            maxLength={3}
            autoComplete="off"
            // Uppercase visually so a typed "del" looks like the code it becomes;
            // the server upper-cases it regardless, because CSS is not validation.
            style={{ textTransform: 'uppercase' }}
            required
          />
        </Field>

        <Field label="To" htmlFor="destination" hint="Airport code, or start typing a city">
          <input
            id="destination"
            name="to"
            list="op-airports"
            className="input"
            defaultValue={values.destination}
            placeholder="BOM"
            maxLength={3}
            autoComplete="off"
            style={{ textTransform: 'uppercase' }}
            required
          />
        </Field>

        <Field label="Departing" htmlFor="departOn">
          <input
            id="departOn"
            name="depart"
            type="date"
            className="input"
            defaultValue={values.departOn}
            min={today}
            max={maxDate}
            required
          />
        </Field>

        <Field label="Returning" htmlFor="returnOn" hint="Used for a return trip" className="op-field-return">
          <input
            id="returnOn"
            name="return"
            type="date"
            className="input"
            defaultValue={values.returnOn}
            min={today}
            max={maxDate}
          />
        </Field>
      </div>

      <div className="op-search-grid op-search-grid-tight">
        <Field label="Adults" htmlFor="adults" hint="12 and over">
          <input
            id="adults"
            name="adults"
            type="number"
            className="input"
            defaultValue={values.adults}
            min={1}
            max={9}
            inputMode="numeric"
          />
        </Field>

        <Field label="Children" htmlFor="children" hint="2 to 11">
          <input
            id="children"
            name="children"
            type="number"
            className="input"
            defaultValue={values.children}
            min={0}
            max={8}
            inputMode="numeric"
          />
        </Field>

        <Field label="Infants" htmlFor="infants" hint="Under 2, on a lap">
          <input
            id="infants"
            name="infants"
            type="number"
            className="input"
            defaultValue={values.infants}
            min={0}
            max={4}
            inputMode="numeric"
          />
        </Field>

        <Field label="Cabin" htmlFor="cabin">
          <select id="cabin" name="cabin" className="select" defaultValue={values.cabin}>
            <option value="ECONOMY">Economy</option>
            <option value="PREMIUM_ECONOMY">Premium economy</option>
            <option value="BUSINESS">Business</option>
            <option value="FIRST">First</option>
          </select>
        </Field>
      </div>

      <div className="row-wrap" style={{ gap: 'var(--s-5)' }}>
        <label className="op-check">
          <input type="checkbox" name="direct" value="1" defaultChecked={values.directOnly} />
          <span>Nonstop only</span>
        </label>

        <label className="op-check">
          <span>Dates can flex by</span>
          <select name="flex" className="select input-inline" defaultValue={String(values.flexDays)}>
            <option value="0">exact dates</option>
            <option value="1">±1 day</option>
            <option value="2">±2 days</option>
            <option value="3">±3 days</option>
          </select>
        </label>
      </div>

      <button type="submit" className="btn btn-primary btn-lg">
        {submitLabel}
      </button>

      {footnote ? <p className="tiny muted">{footnote}</p> : null}
    </form>
  );
}
