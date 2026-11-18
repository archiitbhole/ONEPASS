'use client';

/**
 * The two playground specimens that need a browser: replaying an entrance,
 * and a real dialog. Everything else on the page is server-rendered markup
 * from the product's own components.
 */
import { useRef, useState, type ReactNode } from 'react';

export function Replay({ className, children }: { className: string; children: ReactNode }) {
  const [key, setKey] = useState(0);
  return (
    <div className="stack stack-3">
      <div key={key} className={className}>
        {children}
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setKey((k) => k + 1)}>
        Replay
      </button>
    </div>
  );
}

export function DialogDemo() {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="btn" onClick={() => ref.current?.showModal()}>
        Open a dialog
      </button>
      <dialog ref={ref} className="dialog-native" aria-labelledby="dlg-title">
        <div className="stack stack-4">
          <h2 id="dlg-title" className="h3">
            Cancel this booking?
          </h2>
          <p className="small muted">
            Your seat is released straight away. Whether any money comes back follows the venue&rsquo;s policy — this
            dialog never says a refund happened.
          </p>
          <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>
              Keep it
            </button>
            <button type="button" className="btn btn-danger" onClick={() => ref.current?.close()}>
              Cancel booking
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
