// The analysis panel (spec §4.9): answers to questions about who uses whom,
// computed from the scanned graph. It opens from the "Analysis" button of the
// top bar, at the place of the panel of the interface of the selection, and
// has four lists:
//   - "Cycles": classes, or groups, that use each other in a circle;
//   - "Path": how one of two selected classes reaches the other;
//   - "Usage": the most used classes, and those that nothing uses;
//   - "Changes": the classes whose lines changed since a git reference.
// The lists themselves are in AnalysisTabs.tsx.

import { useMemo, useState } from 'preact/hooks';
import { DiagramController } from '../controller';
import { analyzeUsage } from '../model/usageAnalysis';
import { ChangesTab, CyclesTab, PathTab, UsageTab } from './AnalysisTabs';
import { GlassButton, Segmented, SegmentOption } from './controls';
import { useStore } from './useStore';

type AnalysisTab = 'cycles' | 'path' | 'usage' | 'changes';

const TAB_OPTIONS: SegmentOption[] = [
  { value: 'cycles', label: 'Cycles', title: 'Classes, or groups, that use each other in a circle' },
  { value: 'path', label: 'Path', title: 'How one of two selected classes reaches the other' },
  { value: 'usage', label: 'Usage', title: 'The most used classes, and those that nothing uses' },
  { value: 'changes', label: 'Changes', title: 'The classes changed since the last commit or since a branch' },
];

interface AnalysisPanelProps {
  controller: DiagramController;
}

export function AnalysisPanel({ controller }: AnalysisPanelProps) {
  const store = useStore(controller.store);
  const [tab, setTab] = useState<AnalysisTab>('cycles');
  const { graph, groupKeyByNode } = store;
  const isOpen = store.isAnalysisPanelOpen;
  // Computed again only when the graph or the grouping changes: the store gives a new map of groups then.
  const analysis = useMemo(
    () => (isOpen && graph !== undefined ? analyzeUsage(graph, groupKeyByNode) : undefined),
    [isOpen, graph, groupKeyByNode],
  );
  if (graph === undefined || analysis === undefined) {
    return null;
  }

  return (
    <div class="interface-panel analysis-panel glass">
      <div class="interface-header">
        <span class="section-title">Analysis</span>
        <span class="spacer" />
        <GlassButton icon="close" title="Close the analysis" onPress={() => store.toggleAnalysisPanel()} />
      </div>
      <Segmented options={TAB_OPTIONS} value={tab} onChange={(value) => setTab(value as AnalysisTab)} />
      {tab === 'cycles' && <CyclesTab analysis={analysis} graph={graph} controller={controller} />}
      {tab === 'path' && <PathTab analysis={analysis} graph={graph} controller={controller} />}
      {tab === 'usage' && <UsageTab analysis={analysis} graph={graph} controller={controller} />}
      {tab === 'changes' && <ChangesTab controller={controller} />}
      {tab !== 'changes' && (
        <div class="hint interface-note">
          A class uses another one when it derives from it, holds it, names it in a method or calls it. Every such relation counts, displayed
          or not. Calls are found without a compiler.
        </div>
      )}
    </div>
  );
}
