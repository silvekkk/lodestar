import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {QueuedStateRegenerator, RegenCaller} from "../../regen/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {BinaryDiffCodec} from "../../../util/binaryDiffCodec.js";
import {IStateStorageStrategy, LastFullStateHelper} from "../interface.js";
import {SNAPSHOT_FULL_STATE_EVERY_EPOCHS} from "../constants.js";

export class StateDiffStrategy implements IStateStorageStrategy {
  private initialized: boolean = false;
  private codec: BinaryDiffCodec;

  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {
    this.codec = new BinaryDiffCodec();
  }

  async store(
    {slot, blockRoot}: {slot: Slot; blockRoot: string},
    {getLastFullState}: {getLastFullState: LastFullStateHelper}
  ): Promise<void> {
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
    const {state: snapshotState, slot: snapshotSlot} = await getLastFullState(slot);
    if (!snapshotState) {
      throw Error(`Can not find last snapshot state at slot=${slot}`);
    }

    const intermediateSlots = await this.modules.db.stateArchive.keys({gt: snapshotSlot, lt: slot});

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

  isSlotCompatible(slot: Slot): boolean {
    // Start of the epoch but not the snapshot epoch
    return slot % SLOTS_PER_EPOCH === 0 && computeEpochAtSlot(slot) % SNAPSHOT_FULL_STATE_EVERY_EPOCHS !== 0;
  }

  getLastCompatibleSlot(slot: Slot): Slot {
    const epoch = computeEpochAtSlot(slot);

    if (this.isSlotCompatible(slot)) return computeStartSlotAtEpoch(epoch);

    return Math.max(0, computeStartSlotAtEpoch(epoch - 1));
  }
}
