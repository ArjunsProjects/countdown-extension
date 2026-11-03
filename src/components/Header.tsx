import { nextUnit, UNIT_LABEL } from "../lib/countdown";
import type { Unit } from "../lib/types";
import { enterSelection, exitSelection, isSelecting, selected, selectionMode, setSelected } from "../state/selection";
import { setPrefs } from "../state/store";
import { AddMenu } from "./AddMenu";
import { AppearanceMenu } from "./AppearanceMenu";
import { Checkbox } from "./Checkbox";
import { IconButton } from "./IconButton";
import { ViewMenu } from "./ViewMenu";

interface Props {
  unit: Unit;
  onNew: (categoryId?: string | null) => void;
  onNewCategory: () => void;
  /** Keys selectable in selection mode, for Select all. */
  selectable: string[];
}

export function Header({ unit, onNew, onNewCategory, selectable }: Props) {
  const selecting = isSelecting.value;
  const count = selectable.filter((k) => selected.value.has(k)).length;
  const all = count > 0 && count === selectable.length;

  return (
    <header class="header grid-row">
      <h1 class="visually-hidden">Countdown</h1>
      <div class="select-cell" inert={!selecting}>
        <Checkbox
          checked={all}
          indeterminate={count > 0 && !all}
          disabled={selectable.length === 0}
          onChange={(on) => setSelected(on ? selectable : [])}
          label="Select all"
          hideLabel
        />
      </div>
      <button
        type="button"
        class="unit-label"
        aria-label={`Countdown unit: ${UNIT_LABEL[unit]}. Change unit`}
        data-tooltip="Change unit"
        data-tooltip-align="start"
        onClick={() => setPrefs({ unit: nextUnit(unit) })}
      >
        <span key={unit} class="unit-label__text">
          {UNIT_LABEL[unit]}
        </span>
      </button>
      {/* Announces the new unit to screen readers after a change. */}
      <span class="visually-hidden" aria-live="polite">
        Showing time left in {unit}
      </span>
      <div class="header__actions">
        <span class="add-split">
          <IconButton icon="plus" label="New item" onClick={() => onNew()} disabled={selecting} />
          <AddMenu onNewItem={onNew} onNewCategory={onNewCategory} disabled={selecting} />
        </span>
        <ViewMenu disabled={selecting} />
        <IconButton
          id="import-button"
          icon="import"
          label="Import"
          pressed={selectionMode.value === "import"}
          disabled={selectionMode.value === "export"}
          onClick={() => (selectionMode.value === "import" ? exitSelection() : enterSelection("import"))}
        />
        <IconButton
          id="export-button"
          icon="export"
          label="Export"
          pressed={selectionMode.value === "export"}
          disabled={selectionMode.value === "import"}
          onClick={() => (selectionMode.value === "export" ? exitSelection() : enterSelection("export"))}
        />
        <AppearanceMenu />
      </div>
    </header>
  );
}
