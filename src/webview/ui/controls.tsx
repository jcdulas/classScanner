// The controls of the user interface, drawn in the "liquid glass" style (see styles.css).
//
// Native HTML controls (select, checkbox, range, button) cannot be styled
// consistently, so each control here is built from plain elements with an
// ARIA role, and reacts to the mouse and to the Enter and Space keys.

import { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, IconName } from './Icon';

/** Calls `action` on click, and on Enter or Space when the element has the keyboard focus. */
function pressHandlers(action: () => void, isDisabled = false) {
  return {
    tabIndex: isDisabled ? -1 : 0,
    onClick: () => {
      if (!isDisabled) {
        action();
      }
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (!isDisabled && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        action();
      }
    },
  };
}

interface GlassButtonProps {
  icon?: IconName;
  label?: string;
  title: string;
  onPress: () => void;
  isDisabled?: boolean;
  isActive?: boolean;
  /** `accent` is for the main action of a group. */
  variant?: 'plain' | 'accent';
}

export function GlassButton({ icon, label, title, onPress, isDisabled = false, isActive = false, variant = 'plain' }: GlassButtonProps) {
  const classes = ['glass-button', variant, isActive ? 'active' : '', isDisabled ? 'disabled' : '', label === undefined ? 'icon-only' : ''];
  return (
    <div role="button" class={classes.join(' ')} title={title} aria-disabled={isDisabled} aria-pressed={isActive} {...pressHandlers(onPress, isDisabled)}>
      {icon !== undefined && <Icon name={icon} />}
      {label !== undefined && <span>{label}</span>}
    </div>
  );
}

export interface SegmentOption {
  value: string;
  label: string;
  icon?: IconName;
  title?: string;
}

interface SegmentedProps {
  options: SegmentOption[];
  /** The selected value, or undefined when no option is selected. */
  value: string | undefined;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}

/** A row of options where one is selected, like a set of radio buttons. */
export function Segmented({ options, value, onChange, isDisabled = false }: SegmentedProps) {
  return (
    <div role="radiogroup" class={`segmented ${isDisabled ? 'disabled' : ''}`}>
      {options.map((option) => (
        <div
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          class={`segment ${option.value === value ? 'selected' : ''}`}
          title={option.title ?? option.label}
          {...pressHandlers(() => onChange(option.value), isDisabled)}
        >
          {option.icon !== undefined && <Icon name={option.icon} size={15} />}
          <span>{option.label}</span>
        </div>
      ))}
    </div>
  );
}

interface DropdownProps {
  /** Text shown before the current value, for example "Group by". */
  caption: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}

/** A button that opens a list of options, replacing the native select. */
export function Dropdown({ caption, options, value, onChange, isDisabled = false }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  // Clicking anywhere else closes the list.
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

  return (
    <div class="dropdown" ref={rootRef}>
      <div
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        class={`glass-button ${isDisabled ? 'disabled' : ''}`}
        title={caption}
        {...pressHandlers(() => setIsOpen(!isOpen), isDisabled)}
      >
        <span class="caption">{caption}</span>
        <span>{current?.label}</span>
        <Icon name="chevronDown" size={13} />
      </div>
      {isOpen && (
        <div role="listbox" class="popover glass">
          {options.map((option) => (
            <div
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              class={`menu-item ${option.value === value ? 'selected' : ''}`}
              {...pressHandlers(() => {
                setIsOpen(false);
                onChange(option.value);
              })}
            >
              <span class="menu-check">{option.value === value && <Icon name="check" size={14} />}</span>
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ToggleRowProps {
  isOn: boolean;
  onToggle: () => void;
  children: ComponentChildren;
  /** A switch for a setting that takes effect at once, a check box for an item of a list. */
  kind: 'switch' | 'checkbox';
  title?: string;
  indent?: number;
}

/** A whole row that toggles a setting; the row is the click target, not just the small control. */
export function ToggleRow({ isOn, onToggle, children, kind, title, indent = 0 }: ToggleRowProps) {
  return (
    <div
      role={kind}
      aria-checked={isOn}
      class={`toggle-row ${isOn ? 'on' : ''}`}
      title={title}
      style={{ paddingLeft: `${8 + indent * 14}px` }}
      {...pressHandlers(onToggle)}
    >
      {kind === 'switch' ? (
        <span class="switch">
          <span class="knob" />
        </span>
      ) : (
        <span class="checkbox">{isOn && <Icon name="check" size={12} />}</span>
      )}
      {children}
    </div>
  );
}

interface PressableRowProps {
  className: string;
  title: string;
  onPress: () => void;
  /** For a row that folds what follows it: whether that part is shown. */
  isExpanded?: boolean;
  children: ComponentChildren;
}

/** A row of a list that does something when pressed, like a button as wide as the list. */
export function PressableRow({ className, title, onPress, isExpanded, children }: PressableRowProps) {
  return (
    <div role="button" aria-expanded={isExpanded} class={className} title={title} {...pressHandlers(onPress)}>
      {children}
    </div>
  );
}

interface StepperProps {
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
  label: string;
}

/** A number changed with minus and plus buttons, for small ranges. */
export function Stepper({ value, minimum, maximum, onChange, label }: StepperProps) {
  return (
    <div class="stepper" role="spinbutton" aria-valuenow={value} aria-valuemin={minimum} aria-valuemax={maximum} aria-label={label}>
      <GlassButton icon="minus" title="Less" isDisabled={value <= minimum} onPress={() => onChange(value - 1)} />
      <span class="stepper-value">{value}</span>
      <GlassButton icon="plus" title="More" isDisabled={value >= maximum} onPress={() => onChange(value + 1)} />
    </div>
  );
}

interface SectionProps {
  title: string;
  /** A short summary shown next to the title, for example "3 of 7". */
  summary?: string;
  isInitiallyOpen?: boolean;
  children: ComponentChildren;
}

/** A titled part of the side panel that can be folded. */
export function Section({ title, summary, isInitiallyOpen = true, children }: SectionProps) {
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  return (
    <section class={`panel-section ${isOpen ? 'open' : ''}`}>
      <div role="button" aria-expanded={isOpen} class="section-header" {...pressHandlers(() => setIsOpen(!isOpen))}>
        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} />
        <span class="section-title">{title}</span>
        {summary !== undefined && <span class="section-summary">{summary}</span>}
      </div>
      {isOpen && <div class="section-body">{children}</div>}
    </section>
  );
}
