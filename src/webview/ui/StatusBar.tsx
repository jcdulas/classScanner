// The status line at the bottom of the diagram, and the messages shown over it.

import { DiagramController } from '../controller';
import { useStore } from './useStore';

interface StatusBarProps {
  controller: DiagramController;
}

const LEVEL_LABELS = { overview: 'Overview', compact: 'Compact', full: 'Full detail' };

export function StatusBar({ controller }: StatusBarProps) {
  const store = useStore(controller.store);
  const report = store.report;
  if (store.graph === undefined || report === undefined) {
    return null;
  }
  const hasWarnings = report.parseErrorCount > 0 || report.unresolvedTypeReferenceCount > 0 || report.skippedLargeFiles.length > 0;
  return (
    <div class="status-bar">
      <span>
        {store.visibleNodeIds.size} / {store.graph.nodes.length} classes shown
      </span>
      <span>{LEVEL_LABELS[store.levelOfDetail]}</span>
      {store.selection.size > 0 && <span>{store.selection.size} selected</span>}
      {store.isolation !== null && (
        <span class="chip">
          Isolated: {store.nodeById.get(store.isolation.nodeId)?.name}
          <button title="Exit isolation" onClick={() => store.clearIsolation()}>
            ×
          </button>
        </span>
      )}
      <span class="spacer" />
      <span>
        {report.scannedFileCount} files scanned in {(report.durationMs / 1000).toFixed(1)} s
      </span>
      <button class={hasWarnings ? 'link warning' : 'link'} onClick={() => controller.showReport()}>
        {hasWarnings ? 'Scan report (warnings)' : 'Scan report'}
      </button>
    </div>
  );
}

/** Full-screen messages while there is nothing to show yet, and a banner for errors. */
export function PhaseOverlay({ controller }: StatusBarProps) {
  const store = useStore(controller.store);
  const banner =
    store.failureMessage !== '' && store.phase !== 'failed' ? (
      <div class="banner">
        {store.failureMessage}
        <button onClick={() => store.dismissFailure()}>Dismiss</button>
      </div>
    ) : null;

  if (store.phase === 'layouting') {
    return (
      <>
        {banner}
        <div class="busy-indicator">Computing layout...</div>
      </>
    );
  }
  if (store.phase === 'scanning') {
    const { parsedFileCount, totalFileCount } = store.scanProgress;
    const progress = totalFileCount === 0 ? 'Listing files...' : `Parsing ${parsedFileCount} / ${totalFileCount} files...`;
    return store.graph === undefined ? <div class="overlay">{progress}</div> : <div class="busy-indicator">{progress}</div>;
  }
  if (store.phase === 'waiting') {
    return <div class="overlay">Waiting for the scan...</div>;
  }
  if (store.phase === 'failed') {
    return (
      <div class="overlay">
        <p>{store.failureMessage}</p>
        <button onClick={() => controller.rescan()}>Scan again</button>
      </div>
    );
  }
  return banner;
}
