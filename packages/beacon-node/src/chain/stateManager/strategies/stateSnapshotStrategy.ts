import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {QueuedStateRegenerator, RegenCaller} from "../../regen/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {StateStorageStrategy} from "../interface.js";

export class StateSnapshotStrategy implements StateStorageStrategy {
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
}
