import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {BeaconConfig} from "@lodestar/config";
import {QueuedStateRegenerator} from "../../../regen/index.js";
import {IBeaconDb} from "../../../../db/index.js";
import {BinaryDiffCodec} from "../../../../util/binaryDiffCodec.js";

export class StateDiffStrategy {
  private initialized: boolean = false;
  private codec: BinaryDiffCodec;

  constructor(private modules: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger; config: BeaconConfig}) {
    this.codec = new BinaryDiffCodec();
  }

  async process(_checkpoint: CheckpointWithHex): Promise<void> {
    if (!this.initialized) {
      await this.codec.init();
      this.initialized = true;
    }
  }

  async get(slot: Slot): Promise<Uint8Array | null> {
    return this.modules.db.stateArchive.getBinary(slot);
  }
}
