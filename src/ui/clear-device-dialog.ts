import { CHANGE_SET_JOURNAL_KEY, type ChangeSetJournal } from "../domain/change-sets";
import { LOCAL_STATE_KEY } from "../domain/backup";
import { createEmptyState, type CollectionState } from "../domain/model";

export const SYNTHETIC_DEMO_DISMISSED_KEY = "pokemon-collection.synthetic-demo-dismissed.v1";
export const LAST_IMPORT_BACKUP_KEY = "pokemon-collection.last-import-backup.v1";

export type ExternalDeviceClear = "collection" | "journal" | "synthetic-demo";

export function classifyExternalDeviceClear(key: string | null, newValue: string | null, usingSyntheticDemo: boolean): ExternalDeviceClear | undefined {
  if (key === LOCAL_STATE_KEY && newValue === null) return "collection";
  if (key === CHANGE_SET_JOURNAL_KEY && newValue === null) return "journal";
  if (key === SYNTHETIC_DEMO_DISMISSED_KEY && newValue === "true" && usingSyntheticDemo) return "synthetic-demo";
  return undefined;
}

interface ClearDeviceDependencies {
  collectionStorage: { clear(): void };
  journalStorage: { clear(): void; load(): ChangeSetJournal };
  browserStorage: Pick<Storage, "setItem" | "removeItem">;
}

export function clearPocketdexDevice({ collectionStorage, journalStorage, browserStorage }: ClearDeviceDependencies): { collection: CollectionState; journal: ChangeSetJournal } {
  collectionStorage.clear();
  journalStorage.clear();
  browserStorage.removeItem(LAST_IMPORT_BACKUP_KEY);
  browserStorage.setItem(SYNTHETIC_DEMO_DISMISSED_KEY, "true");
  return { collection: createEmptyState(), journal: journalStorage.load() };
}

export function renderClearDeviceDialog(open: boolean): string {
  if (!open) return "";

  return `<div class="confirm-overlay"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-device-title" aria-describedby="clear-device-description" data-clear-device-dialog><div class="confirm-dialog__icon" aria-hidden="true">!</div><div><p class="eyebrow">Confirmación necesaria</p><h2 id="clear-device-title">¿Borrar los datos de este dispositivo?</h2><p id="clear-device-description" class="muted">Se eliminarán la colección, Quiero, las copias de recuperación y el historial local. Solo podrás recuperarlos si antes exportaste una copia.</p></div><div class="confirm-dialog__actions"><button class="button button--quiet" type="button" data-action="cancel-clear-device">Cancelar</button><button class="button button--danger" type="button" data-action="confirm-clear-device">Sí, borrar datos locales</button></div></section></div>`;
}

export function wrappedDialogFocusIndex(activeIndex: number, reverse: boolean, itemCount: number): number | undefined {
  if (itemCount < 1) return undefined;
  if (activeIndex < 0) return reverse ? itemCount - 1 : 0;
  if (reverse && activeIndex === 0) return itemCount - 1;
  if (!reverse && activeIndex === itemCount - 1) return 0;
  return undefined;
}
