import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {QueuedStateRegenerator, RegenCaller} from "../../regen/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {BinaryDiffCodec} from "../../../util/binaryDiffCodec.js";
import {StateStorageStrategy} from "../interface.js";
import {getLastSnapshotSlot} from "./index.js";

export class StateDiffStrategy implements StateStorageStrategy {
  private initialized: boolean = false;
  private codec: BinaryDiffCodec;

  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {
    this.codec = new BinaryDiffCodec();
  }

  async store({slot, blockRoot}: {slot: Slot; blockRoot: string}): Promise<void> {
    if (!this.initialized) {
      await this.codec.init();
      this.initialized = true;
    }

    const currentState = await this.modules.regen.getBlockSlotState(
      blockRoot,
      slot,
      {dontTransferCache: false},
      RegenCaller.stateManager
    );
    const snapshotSlot = getLastSnapshotSlot(slot);
    const snapshotState = await this.modules.db.stateArchive.getBinary(slot);
    const intermediateSlots = await this.modules.db.stateArchive.keys({gt: snapshotSlot, lt: slot});
    if (!snapshotState) {
      throw Error(`Can not find last snapshot state at slot=${slot}`);
    }
    let activeState: Uint8Array = snapshotState;

    // TODO: Do this process in the worker
    for (const intermediateSlot of intermediateSlots) {
      const patch = await this.get(intermediateSlot);
      if (!patch) continue;

      activeState = this.codec.apply(activeState, patch);
    }
    const diff = this.codec.compute(currentState.serialize(), activeState);
    await this.modules.db.stateArchive.putBinary(slot, diff);
  }

  async get(slot: Slot): Promise<Uint8Array | null> {
    return this.modules.db.stateArchive.getBinary(slot);
  }
}
