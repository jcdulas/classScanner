// Search by class name (spec §4.6): a case-insensitive substring match on the
// short and qualified names. Choosing a result selects the class and moves
// the camera to it.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DiagramController } from '../controller';

const MAX_RESULTS = 30;

interface SearchBoxProps {
  controller: DiagramController;
}

export function SearchBox({ controller }: SearchBoxProps) {
  const store = controller.store;
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+F (Cmd+F on macOS) focuses the search box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '' || store.graph === undefined) {
      return [];
    }
    const matches = store.graph.nodes.filter((node) => node.id.toLowerCase().includes(needle) && store.visibleNodeIds.has(node.id));
    // Names that start with the query come first, then shorter names.
    matches.sort((first, second) => {
      const firstStarts = first.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const secondStarts = second.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return firstStarts - secondStarts || first.name.length - second.name.length || first.id.localeCompare(second.id);
    });
    return matches.slice(0, MAX_RESULTS);
  }, [query, store.graph, store.visibleNodeIds]);

  const choose = (id: string) => {
    controller.focusNode(id);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && results.length > 0) {
      choose(results[Math.min(highlightedIndex, results.length - 1)].id);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div class="search">
      <input
        ref={inputRef}
        type="search"
        placeholder="Search classes (Ctrl+F)"
        value={query}
        onInput={(event) => {
          setQuery(event.currentTarget.value);
          setHighlightedIndex(0);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {isOpen && results.length > 0 && (
        <ul class="search-results">
          {results.map((node, index) => (
            <li
              key={node.id}
              class={index === highlightedIndex ? 'highlighted' : ''}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(node.id);
              }}
            >
              <span class="result-name">{node.name}</span>
              <span class="result-namespace">{node.namespace}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
