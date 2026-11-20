// The small floating elements around the diagram: the status pill (bottom left), the zoom
// controls (bottom right, above the minimap), and the messages shown while the diagram is busy.

import { DiagramController } from '../controller';
import { GlassButton } from './controls';
import { useCameraScale, useStore } from './useStore';

interface ControllerProps {
  controller: DiagramController;
}

const LEVEL_LABELS = { overview: 'Overview', compact: 'Names', full: 'Full detail' };

export function StatusPill({ controller }: ControllerProps) {
  const store = useStore(controller.store);
  const report = store.report;
  if (store.graph === undefined || report === undefined) {
    return null;
  }
  const hasWarnings = report.parseErrorCount > 0 || report.unresolvedTypeReferenceCount > 0 || report.skippedLargeFiles.length > 0;
  return (
    <div class="status-pill glass bar">
      <span>
        <strong>{store.visibleNodeIds.size}</strong> of {store.graph.nodes.length} classes
      </span>
      <span class="status-muted">{LEVEL_LABELS[store.levelOfDetail]}</span>
      {store.isolation !== null && (
        <span class="chip">
          Isolated: {store.nodeById.get(store.isolation.nodeId)?.name}
          <GlassButton icon="close" title="Exit isolation" onPress={() => store.clearIsolation()} />
        </span>
      )}
      <span class="status-muted" title={report.pairedFolder === undefined ? undefined : `Scanned together with ${report.pairedFolder}`}>
        {report.scannedFileCount} files{report.pairedFolder === undefined ? '' : ' in 2 folders'}, {(report.durationMs / 1000).toFixed(1)} s
      </span>
      <GlassButton
        label={report.depth < 0 ? 'Depth: all' : `Depth: ${report.depth}`}
        title="Change the scan depth and scan again"
        onPress={() => controller.changeDepth()}
      />
      <GlassButton
        icon="report"
        label={hasWarnings ? 'Warnings' : undefined}
        title={hasWarnings ? 'The scan reported warnings: open the scan report' : 'Open the scan report'}
        isActive={hasWarnings}
        onPress={() => controller.showReport()}
      />
    </div>
  );
}

export function ZoomControls({ controller }: ControllerProps) {
  const scale = useCameraScale(controller.store);
  return (
    <div class="zoom-controls glass bar">
      <GlassButton icon="minus" title="Zoom out" onPress={() => controller.zoomBy(1 / 1.4)} />
      <span class="zoom-value" title="Zoom level">
        {scale === undefined ? '' : `${Math.round(scale * 100)}%`}
      </span>
      <GlassButton icon="plus" title="Zoom in" onPress={() => controller.zoomBy(1.4)} />
      <GlassButton icon="fit" title="Show the whole diagram" onPress={() => controller.fitToView()} />
    </div>
  );
}

/** Full-screen messages while there is nothing to show yet, and a banner for errors. */
export function PhaseOverlay({ controller }: ControllerProps) {
  const store = useStore(controller.store);
  const banner =
    store.failureMessage !== '' && store.phase !== 'failed' ? (
      <div class="banner glass bar">
        <span>{store.failureMessage}</span>
        <GlassButton icon="close" title="Dismiss" onPress={() => store.dismissFailure()} />
      </div>
    ) : null;

  if (store.phase === 'layouting') {
    return (
      <>
        {banner}
        <div class="busy-indicator glass bar">
          <span class="spinner" />
          Computing layout...
        </div>
      </>
    );
  }
  if (store.phase === 'scanning') {
    const { parsedFileCount, totalFileCount } = store.scanProgress;
    const progress = totalFileCount === 0 ? 'Listing files...' : `Parsing ${parsedFileCount} of ${totalFileCount} files...`;
    const indicator = (
      <div class="busy-indicator glass bar">
        <span class="spinner" />
        {progress}
      </div>
    );
    return store.graph === undefined ? <div class="overlay">{indicator}</div> : indicator;
  }
  if (store.phase === 'waiting') {
    return (
      <div class="overlay">
        <div class="busy-indicator glass bar">
          <span class="spinner" />
          Waiting for the scan...
        </div>
      </div>
    );
  }
  if (store.phase === 'failed') {
    return (
      <div class="overlay">
        <div class="failure glass">
          <p>{store.failureMessage}</p>
          <GlassButton icon="rescan" label="Scan again" title="Scan the folder again" variant="accent" onPress={() => controller.rescan()} />
        </div>
      </div>
    );
  }
  return banner;
}
