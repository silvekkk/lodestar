import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {QueuedStateRegenerator, RegenCaller} from "../../regen/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {IStateStorageStrategy, StateStorageStrategy} from "../interface.js";
import {SNAPSHOT_FULL_STATE_EVERY_EPOCHS} from "../constants.js";

export class StateSnapshotStrategy implements IStateStorageStrategy<StateStorageStrategy.Snapshot> {
  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {}

  async store({slot, blockRoot}: {slot: Slot; blockRoot: string}): Promise<void> {
    const state = await this.modules.regen.getBlockSlotState(
      blockRoot,
      slot,
      {dontTransferCache: false},
      RegenCaller.stateManager
    );

    await this.modules.db.stateArchive.putBinary(slot, state.serialize());
    this.modules.logger.verbose("State stored as snapshot", {
      epoch: computeEpochAtSlot(slot),
      slot,
      blockRoot,
    });
  }

  async get(slot: Slot): Promise<Uint8Array | null> {
    return this.modules.db.stateArchive.getBinary(slot);
  }

  isSlotCompatible(slot: Slot): boolean {
    return slot % SLOTS_PER_EPOCH === 0 && computeEpochAtSlot(slot) % SNAPSHOT_FULL_STATE_EVERY_EPOCHS === 0;
  }

  getLastCompatibleSlot(slot: Slot): Slot {
    const epoch = computeEpochAtSlot(slot);

    if (this.isSlotCompatible(computeEpochAtSlot(slot))) return computeStartSlotAtEpoch(epoch);

    return Math.max(0, computeStartSlotAtEpoch(epoch - SNAPSHOT_FULL_STATE_EVERY_EPOCHS));
  }
}
