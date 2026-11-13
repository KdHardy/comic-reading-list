import { useEffect } from 'react';
import type { StuartScanError } from '../lib/types';

interface Props {
  errors: StuartScanError[];
  onClose: () => void;
}

function comicLabel(error: StuartScanError): string {
  const volume = error.volume ? ` (${error.volume})` : '';
  const number = error.number ? ` #${error.number}` : '';
  return `${error.series ?? 'Unknown series'}${volume}${number}`;
}

/** Stuart's open scan failures, grouped by comic, with the raw details for troubleshooting. */
export function ScanErrorsDialog({ errors, onClose }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal scan-errors-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-errors-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="scan-errors-heading">Metadata scan failures</h2>
        <p className="title-art-editor-hint">
          Stuart couldn't match these comics to a series/volume. Each is retried after a week (up to three times),
          or sooner if you edit the comic. Details are also in the <code>stuart_scan_error</code> table.
        </p>

        <ul className="scan-errors-list">
          {errors.map((error) => (
            <li key={error.error_id} className="scan-error">
              <div className="scan-error-title">
                {comicLabel(error)}
                {error.publisher && <span className="pull-list-muted"> · {error.publisher}</span>}
              </div>
              <div className="scan-error-message">
                <span className="scan-error-code">{error.code}</span> {error.message}
              </div>
              <div className="scan-error-meta">
                {error.adapter} · {new Date(error.created_at).toLocaleString()}
              </div>
              {error.details != null && (
                <details>
                  <summary>Details</summary>
                  <pre>{JSON.stringify(error.details, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>

        <div className="modal-actions">
          <span className="modal-actions-spacer" />
          <button type="button" className="modal-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
