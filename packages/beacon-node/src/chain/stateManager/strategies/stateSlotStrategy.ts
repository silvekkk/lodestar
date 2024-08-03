import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  stateTransition,
} from "@lodestar/state-transition";
import {QueuedStateRegenerator} from "../../regen/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {IStateStorageStrategy, StateStorageStrategy, StorageStrategyContext} from "../interface.js";

export class StateSlotStrategy implements IStateStorageStrategy<StateStorageStrategy.Slot> {
  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {}

  // We don't store the state for the non-epoch boundary slots
  async store(_opts: {slot: Slot; blockRoot: string}): Promise<void> {}

  async get(slot: Slot, context: StorageStrategyContext<StateStorageStrategy.Slot>): Promise<Uint8Array | null> {
    // If slot is snapshot slot, return snapshot
    // If slot is epoch boundary, return state diff
    // If slot is in middle of epoch
    //  - get state diff for epoch start
    //  - replay remaining blocks
    const epoch = computeEpochAtSlot(slot);
    const epochStartSlot = computeStartSlotAtEpoch(epoch);
    const epochStartState = await context.strategies.diff.get(epochStartSlot);
    if (!epochStartState) {
      throw new Error(`Can not find the state for the start of epoch=${epoch}`);
    }

    let state = createCachedBeaconState(
      this.modules.config.getForkTypes(slot).BeaconState.deserializeToViewDU(epochStartState),
      {
        config: this.modules.config,
        pubkey2index: [],
        index2pubkey: [],
      },
      {
        skipSyncPubkeys: true,
      }
    );

    let blockCount = 0;

    for await (const block of this.modules.db.blockArchive.valuesStream({gt: epochStartSlot, lte: slot})) {
      try {
        state = stateTransition(
          state,
          block,
          {
            verifyProposer: false,
            verifySignatures: false,
            verifyStateRoot: false,
            executionPayloadStatus: ExecutionPayloadStatus.valid,
            dataAvailableStatus: DataAvailableStatus.available,
          },
          metrics
        );
      } catch (e) {
        // metrics?.regenErrorCount.inc({reason: RegenErrorType.blockProcessing});
        console.log("Nazar");
        throw e;
      }
      blockCount++;
      if (Buffer.compare(state.hashTreeRoot(), block.message.stateRoot) !== 0) {
        // metrics?.regenErrorCount.inc({reason: RegenErrorType.invalidStateRoot});
      }
    }

    return state.serialize();
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
