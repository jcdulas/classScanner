// The "LLM schema" button of the selection bar. It opens a small panel to choose how much
// detail the schema contains, shows an estimate of its size, and copies it to the clipboard.
// The size matters because the schema is meant to be pasted into a prompt.

import { useEffect, useRef, useState } from 'preact/hooks';
import { SchemaMemberLevel } from '../../shared/savedState';
import { DiagramController } from '../controller';
import { GlassButton, Segmented, SegmentOption, ToggleRow } from './controls';
import { useStore } from './useStore';

const MEMBER_OPTIONS: SegmentOption[] = [
  { value: 'all', label: 'All', title: 'Every member' },
  { value: 'nonPrivate', label: 'No private', title: 'Public and protected members' },
  { value: 'public', label: 'Public', title: 'Public members only' },
  { value: 'none', label: 'None', title: 'Only the classes and their relations' },
];

interface SchemaButtonProps {
  controller: DiagramController;
}

export function SchemaButton({ controller }: SchemaButtonProps) {
  const store = useStore(controller.store);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes the panel.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [isOpen]);

  const detail = store.schemaDetail;
  const tokenCount = isOpen ? controller.estimateSelectionSchemaTokens() : undefined;

  return (
    <div class="dropdown" ref={rootRef}>
      <GlassButton
        icon="copy"
        label="LLM schema"
        title="A compact description of the selection, to paste into a prompt for a language model"
        isActive={isOpen}
        onPress={() => setIsOpen(!isOpen)}
      />
      {isOpen && (
        <div class="popover popover-up glass schema-panel">
          <div class="panel-caption">Members</div>
          <Segmented options={MEMBER_OPTIONS} value={detail.members} onChange={(value) => store.setSchemaDetail({ members: value as SchemaMemberLevel })} />
          <ToggleRow
            kind="switch"
            isOn={detail.includeLocations}
            onToggle={() => store.setSchemaDetail({ includeLocations: !detail.includeLocations })}
            title="Write the file and line of each class"
          >
            <span class="row-label">File locations</span>
          </ToggleRow>
          <div class="schema-footer">
            <span class="status-muted" title="An estimate: about one token for four characters">
              {tokenCount === undefined ? '' : `About ${tokenCount.toLocaleString('en-US')} tokens`}
            </span>
            <GlassButton
              icon="copy"
              label="Copy"
              title="Copy the schema to the clipboard"
              variant="accent"
              onPress={() => {
                controller.copySelectionAsSchema();
                setIsOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
