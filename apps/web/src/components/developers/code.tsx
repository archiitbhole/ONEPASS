'use client';

/**
 * Code blocks for the developer platform: copyable, and coloured where colour
 * helps.
 *
 * Two client components, kept small on purpose. Everything else under
 * /developers is server-rendered — a reference page that needs JavaScript to
 * show its content is a reference page that is blank for the first 300ms and
 * empty forever if a bundle fails. What genuinely needs the browser is the act
 * of copying and nothing else, so that is all that ships.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/* ────────────────────────────  copy  ──────────────────────────── */

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing on unmount matters here: the endpoint explorer mounts dozens of
  // these, and a timer firing into an unmounted component is a warning in
  // development and a leak in a long-lived tab.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is refused in a few real situations — an insecure
      // origin, a browser policy, a headless run. Saying nothing would leave a
      // button that silently does nothing, so the button says so itself.
      setCopied(false);
      window.prompt('Copy this:', text);
    }
  }, [text]);

  return (
    <button
      type="button"
      className="code-copy"
      onClick={copy}
      data-copied={copied}
      /* The label changes to "Copied", so the accessible name has to change with
         it — otherwise a screen reader hears "Copy" after a successful copy. */
      aria-label={copied ? 'Copied to clipboard' : `${label} to clipboard`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/* ────────────────────────────  colour  ──────────────────────────── */

/**
 * Colour a JSON document by role: key, string, number, literal, punctuation.
 *
 * Written rather than pulled in, because a highlighter is a dependency that
 * ships a grammar engine to paint five colours. The tokeniser walks the string
 * once and never runs a regex over user input — every block on these pages is
 * a constant from the catalogue.
 */
function colour(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;

  const push = (className: string | null, text: string) => {
    if (!text) return;
    out.push(
      className ? (
        <span key={n++} className={className}>
          {text}
        </span>
      ) : (
        <span key={n++}>{text}</span>
      ),
    );
  };

  while (i < json.length) {
    const ch = json[i]!;

    if (ch === '"') {
      // Walk to the closing quote, honouring escapes.
      let j = i + 1;
      while (j < json.length) {
        if (json[j] === '\\') j += 2;
        else if (json[j] === '"') break;
        else j += 1;
      }
      const literal = json.slice(i, Math.min(j + 1, json.length));
      // A string followed by a colon is a key; anything else is a value.
      let k = j + 1;
      while (k < json.length && (json[k] === ' ' || json[k] === '\t')) k += 1;
      push(json[k] === ':' ? 'j-key' : 'j-str', literal);
      i = j + 1;
      continue;
    }

    if (/[-\d]/.test(ch) && /[\s:[,]/.test(json[i - 1] ?? ' ')) {
      let j = i;
      while (j < json.length && /[-+.\deE]/.test(json[j]!)) j += 1;
      push('j-num', json.slice(i, j));
      i = j;
      continue;
    }

    const literal = ['true', 'false', 'null'].find((l) => json.startsWith(l, i));
    if (literal) {
      push('j-lit', literal);
      i += literal.length;
      continue;
    }

    if ('{}[],:'.includes(ch)) {
      push('j-punc', ch);
      i += 1;
      continue;
    }

    // Whitespace, batched — it is most of a formatted document, and one span
    // per space would triple the node count for no visible difference.
    if (/\s/.test(ch)) {
      let j = i;
      while (j < json.length && /\s/.test(json[j]!)) j += 1;
      push(null, json.slice(i, j));
      i = j;
      continue;
    }

    // Anything else: one character at a time. Batching here is what would make
    // the scanner run past the start of the next `true` or `42` and swallow it.
    push(null, ch);
    i += 1;
  }

  return out;
}

/**
 * A code block with a copy button, coloured when it is JSON.
 *
 * `language` is a hint, not a parser selection: a curl example is left plain
 * because colouring a shell command by guessing at its tokens looks wrong more
 * often than it looks right.
 */
export function Code({
  children,
  language = 'json',
  label,
  title,
}: {
  children: string;
  language?: 'json' | 'plain';
  label?: string;
  /** Rendered in the bar above the block, beside the copy button. */
  title?: string;
}) {
  return (
    <div className="code-wrap">
      {/* The button sits in a bar above the block rather than floating over it.
          Overlaying was the obvious thing and it was wrong: a code block scrolls
          horizontally, so the button covered whatever happened to be under it —
          and on the curl examples that was the start of the URL. A bar costs one
          row and can never hide a character. */}
      <div className="code-head">
        {title ? <span className="code-label">{title}</span> : null}
        <CopyButton text={children} label={label} />
      </div>
      <pre className="code-block" tabIndex={0}>
        {language === 'json' ? colour(children) : children}
      </pre>
    </div>
  );
}
