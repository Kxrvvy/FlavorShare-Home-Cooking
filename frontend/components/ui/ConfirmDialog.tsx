"use client";

/* A yes/no dialog for an action worth pausing over - built for the recipe
 * builder's Delete button, which used to ask through the browser's own
 * window.confirm(). That works, but it looks like a browser error rather
 * than a part of this app, and it can't be styled or reused. This is a
 * proper overlay instead: a dimmed backdrop, a centred card, and two
 * buttons, matching the rest of the app's own controls.
 *
 * Nothing else in the frontend uses a real overlay dialog yet - other
 * confirmations (meal plans) still call window.confirm() directly. This
 * only replaces the one this was asked for; sweeping the others is a
 * separate call to make later.
 */

import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  body: string;
  /** Label for the destructive/confirming action, e.g. "Delete". */
  confirmLabel: string;
  /** Shown on the confirm button while `busy` is true, e.g. "Deleting...". */
  busyLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busyLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  /* Escape cancels rather than confirms - the same direction AccountMenu and
   * the mobile drawer already close on Escape, and the safe one for a
   * destructive action: dismissing by accident should never be the one that
   * deletes something. */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-5 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-rule bg-card p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="font-display text-lg font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted">{body}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full bg-maroon px-4 py-2 font-display text-xs font-semibold text-card disabled:opacity-50"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
