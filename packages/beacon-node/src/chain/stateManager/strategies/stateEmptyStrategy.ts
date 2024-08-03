import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {QueuedStateRegenerator} from "../../regen/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {IStateStorageStrategy, StateStorageStrategy} from "../interface.js";

export class StateEmptyStrategy implements IStateStorageStrategy<StateStorageStrategy.Empty> {
  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {}

  async store(_opts: {slot: Slot; blockRoot: string}): Promise<void> {}

  async get(_slot: Slot): Promise<Uint8Array | null> {
    // If slot is snapshot slot, return snapshot
    // If slot is epoch boundary, return state diff
    // If slot is in middle of epoch
    //  - get state diff for epoch start
    //  - replay remaining blocks
    return null;
  }

  isSlotCompatible(slot: Slot): boolean {
    // Every slot which is not start of the epoch
    return slot % SLOTS_PER_EPOCH !== 0;
  }

  getLastCompatibleSlot(slot: Slot): Slot {
    // Return second last slot if last slot is start of epoch
    if ((slot - 1) % SLOTS_PER_EPOCH === 0) return slot - 2;

    // Return last slot
    return slot - 1;
  }
}
