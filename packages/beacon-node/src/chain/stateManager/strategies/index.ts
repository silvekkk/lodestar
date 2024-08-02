import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";

export * from "./stateDiffStrategy.js";
export * from "./stateSnapshotStrategy.js";

export enum StateStorageStrategy {
  Snapshot = "snapshot",
  Diff = "diff",
  Skip = "skip",
}

// Persist full state every 100
const SNAPSHOT_FULL_STATE_EVERY_EPOCHS = 100;

export function isSnapshotSlot(slot: Slot): boolean {
  return computeEpochAtSlot(slot) % SNAPSHOT_FULL_STATE_EVERY_EPOCHS === 0;
}

export function getStateStorageStrategy(slot: Slot): StateStorageStrategy {
  // Store snapshot at genesis
  if (slot === 0) return StateStorageStrategy.Snapshot;

  // If start of epoch and full state epoch
  if (slot % SLOTS_PER_EPOCH == 0 && isSnapshotSlot(slot)) return StateStorageStrategy.Snapshot;

  // Every start of the epoch store the diff
  if (slot % SLOTS_PER_EPOCH == 0) return StateStorageStrategy.Diff;

  // Skip slots between epoch boundary to reduce the storage size
  return StateStorageStrategy.Skip;
}

export function getLastSnapshotSlot(slot: Slot): Slot {
  const epoch = computeEpochAtSlot(slot);

  if (isSnapshotSlot(computeEpochAtSlot(slot))) return computeStartSlotAtEpoch(epoch);

  return Math.max(0, computeStartSlotAtEpoch(epoch - SNAPSHOT_FULL_STATE_EVERY_EPOCHS));
}
