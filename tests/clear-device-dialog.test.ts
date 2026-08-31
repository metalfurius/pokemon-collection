import { describe, expect, it } from "vitest";
import { CHANGE_SET_JOURNAL_KEY, createChangeSetJournalStore, createEmptyChangeSetJournal } from "../src/domain/change-sets";
import { LOCAL_STATE_KEY, createLocalStateStore } from "../src/domain/backup";
import { syntheticState } from "../src/fixtures/synthetic";
import { SYNTHETIC_DEMO_DISMISSED_KEY, clearPocketdexDevice, renderClearDeviceDialog, wrappedDialogFocusIndex } from "../src/ui/clear-device-dialog";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

describe("clear-device confirmation", () => {
  it("renders only while requested with complete accessible dialog semantics", () => {
    expect(renderClearDeviceDialog(false)).toBe("");

    const markup = renderClearDeviceDialog(true);
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="clear-device-title"');
    expect(markup).toContain('aria-describedby="clear-device-description"');
    expect(markup).toContain('id="clear-device-title"');
    expect(markup).toContain('id="clear-device-description"');
    expect(markup).toContain('data-action="cancel-clear-device"');
    expect(markup).toContain('data-action="confirm-clear-device"');
    expect(markup.indexOf('data-action="cancel-clear-device"')).toBeLessThan(markup.indexOf('data-action="confirm-clear-device"'));
    expect(markup).toContain("Solo podrás recuperarlos si antes exportaste una copia.");
  });

  it("wraps keyboard focus inside the dialog", () => {
    expect(wrappedDialogFocusIndex(-1, false, 2)).toBe(0);
    expect(wrappedDialogFocusIndex(-1, true, 2)).toBe(1);
    expect(wrappedDialogFocusIndex(0, true, 2)).toBe(1);
    expect(wrappedDialogFocusIndex(1, false, 2)).toBe(0);
    expect(wrappedDialogFocusIndex(0, false, 2)).toBeUndefined();
    expect(wrappedDialogFocusIndex(0, false, 0)).toBeUndefined();
  });

  it("clears only Pocketdex data and prevents the synthetic demo from returning", () => {
    const browserStorage = memoryStorage();
    const collectionStorage = createLocalStateStore(browserStorage);
    const journalStorage = createChangeSetJournalStore(browserStorage);
    collectionStorage.save(syntheticState());
    journalStorage.save(createEmptyChangeSetJournal());
    browserStorage.setItem("unrelated.sentinel", "keep");

    const cleared = clearPocketdexDevice({ collectionStorage, journalStorage, browserStorage });

    expect(browserStorage.getItem(LOCAL_STATE_KEY)).toBeNull();
    expect(browserStorage.getItem(CHANGE_SET_JOURNAL_KEY)).toBeNull();
    expect(browserStorage.getItem(SYNTHETIC_DEMO_DISMISSED_KEY)).toBe("true");
    expect(browserStorage.getItem("unrelated.sentinel")).toBe("keep");
    expect(cleared.collection.records).toEqual([]);
    expect(cleared.journal).toEqual(createEmptyChangeSetJournal());
  });
});
