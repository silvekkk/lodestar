import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {BeaconConfig} from "@lodestar/config";
import {QueuedStateRegenerator} from "../../../regen/index.js";
import {IBeaconDb} from "../../../../db/index.js";
import {getStateSlotFromBytes} from "../../../../util/multifork.js";

export class StateSnapshotStrategy {
  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {}

  async process(checkpoint: CheckpointWithHex): Promise<void> {
    const finalizedStateOrBytes = await this.modules.regen.getCheckpointStateOrBytes(checkpoint);
    if (!finalizedStateOrBytes) {
      throw Error(
        `No state in cache for finalized checkpoint state epoch #${checkpoint.epoch} root ${checkpoint.rootHex}`
      );
    }
    if (finalizedStateOrBytes instanceof Uint8Array) {
      const slot = getStateSlotFromBytes(finalizedStateOrBytes);
      await this.modules.db.stateArchive.putBinary(slot, finalizedStateOrBytes);
      this.modules.logger.verbose("State stored as snapshot", {
        epoch: checkpoint.epoch,
        slot,
        root: checkpoint.rootHex,
      });
    } else {
      const slot = finalizedStateOrBytes.slot;
      await this.modules.db.stateArchive.putBinary(slot, finalizedStateOrBytes.serialize());
      this.modules.logger.verbose("State stored as snapshot", {
        epoch: checkpoint.epoch,
        slot,
        root: checkpoint.rootHex,
      });
    }
  }

  async get(slot: Slot): Promise<Uint8Array | null> {
    return this.modules.db.stateArchive.getBinary(slot);
  }
}
