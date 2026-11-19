// Search by name (spec §4.6): a case-insensitive substring match on the names of the
// classes, and on the names of their methods and attributes. Choosing a result selects its
// class and moves the camera to it; the result can also be opened in the editor.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ClassNode, Graph, Member } from '../../shared/graphModel';
import { DiagramController } from '../controller';
import { Icon } from './Icon';

const MAX_CLASS_RESULTS = 20;
const MAX_MEMBER_RESULTS = 30;

interface SearchResult {
  key: string;
  node: ClassNode;
  /** Set when the result is a method or an attribute of `node`. */
  member?: Member;
  kind: 'class' | 'method' | 'attribute';
  name: string;
  /** Where the result is: the namespace of a class, the class of a member. */
  context: string;
}

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
    return findResults(store.graph, store.visibleNodeIds, needle);
  }, [query, store.graph, store.visibleNodeIds]);

  const close = () => {
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const showInDiagram = (result: SearchResult) => {
    controller.focusNode(result.node.id);
    close();
  };

  const openInEditor = (result: SearchResult) => {
    const location = result.member ?? result.node;
    controller.openSource(location.file, location.line);
    close();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && results.length > 0) {
      const result = results[Math.min(highlightedIndex, results.length - 1)];
      // Enter shows the result in the diagram, Ctrl+Enter opens it in the editor.
      if (event.ctrlKey || event.metaKey) {
        openInEditor(result);
      } else {
        showInDiagram(result);
      }
    } else if (event.key === 'Escape') {
      close();
    }
  };

  return (
    <div class="search">
      <div class="search-field">
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          type="text"
          spellcheck={false}
          placeholder="Search classes and members"
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
        {query === '' ? (
          <span class="key-hint">Ctrl F</span>
        ) : (
          <span class="search-clear" role="button" title="Clear" onMouseDown={() => setQuery('')}>
            <Icon name="close" size={13} />
          </span>
        )}
      </div>
      {isOpen && results.length > 0 && (
        <div class="popover glass search-results" role="listbox">
          {results.map((result, index) => (
            <div
              key={result.key}
              role="option"
              aria-selected={index === highlightedIndex}
              class={`menu-item ${index === highlightedIndex ? 'highlighted' : ''}`}
              title="Enter: show in the diagram. Ctrl+Enter: open in the editor."
              onMouseDown={(event) => {
                event.preventDefault();
                showInDiagram(result);
              }}
            >
              <span class={`result-kind kind-${result.kind}`}>{result.kind}</span>
              <span class="result-name">{result.name}</span>
              <span class="result-context">{result.context}</span>
              <span
                class="result-open"
                role="button"
                title="Open in the editor"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openInEditor(result);
                }}
              >
                <Icon name="code" size={14} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The classes, then the members, whose name contains `needle` (already in lower case). */
function findResults(graph: Graph, visibleNodeIds: Set<string>, needle: string): SearchResult[] {
  const classes: SearchResult[] = [];
  const members: SearchResult[] = [];
  for (const node of graph.nodes) {
    if (!visibleNodeIds.has(node.id)) {
      continue;
    }
    if (node.id.toLowerCase().includes(needle)) {
      classes.push({ key: node.id, node, kind: 'class', name: node.name, context: node.namespace });
    }
    const addMembers = (list: Member[], kind: 'method' | 'attribute') => {
      for (const member of list) {
        if (member.name.toLowerCase().includes(needle)) {
          members.push({ key: `${node.id}|${kind}|${member.name}|${member.line}`, node, member, kind, name: member.name, context: node.name });
        }
      }
    };
    addMembers(node.attributes, 'attribute');
    addMembers(node.methods, 'method');
  }
  // Names that start with the query come first, then shorter names.
  const byRelevance = (first: SearchResult, second: SearchResult) => {
    const firstStarts = first.name.toLowerCase().startsWith(needle) ? 0 : 1;
    const secondStarts = second.name.toLowerCase().startsWith(needle) ? 0 : 1;
    return firstStarts - secondStarts || first.name.length - second.name.length || first.key.localeCompare(second.key);
  };
  return [...classes.sort(byRelevance).slice(0, MAX_CLASS_RESULTS), ...members.sort(byRelevance).slice(0, MAX_MEMBER_RESULTS)];
}
