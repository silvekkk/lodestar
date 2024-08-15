import {toHexString} from "@chainsafe/ssz";
import {Epoch, RootHex, ssz, ValidatorIndex} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {
  DOMAIN_BEACON_ATTESTER,
  GENESIS_SLOT,
  MAX_COMMITTEES_PER_SLOT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "@lodestar/params";
import {BeaconConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "../types.js";
import {getSeed} from "./seed.js";
import {unshuffleList} from "./shuffle.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeAnchorCheckpoint} from "./computeAnchorCheckpoint.js";

export interface IShufflingCache {
  /**
   * Will synchronously get a shuffling if it is available or will return null if not.
   */
  getSync(epoch: Epoch, decisionRoot: RootHex): EpochShuffling | null;

  /**
   * Gets a cached shuffling via the epoch and decision root.  If the shuffling is not
   * available it will build it synchronously and return the shuffling.
   *
   * NOTE: If a shuffling is already queued and not calculated it will build and resolve
   * the promise but the already queued build will happen at some later time
   */
  getOrBuildSync(
    epoch: Epoch,
    decisionRoot: RootHex,
    state: BeaconStateAllForks,
    activeIndices: ValidatorIndex[],
    activeIndicesLength: number
  ): EpochShuffling;

  /**
   * Queue asynchronous build for an EpochShuffling
   */
  build(
    epoch: Epoch,
    decisionRoot: RootHex,
    state: BeaconStateAllForks,
    activeIndices: ValidatorIndex[],
    activeIndicesLength: number
  ): void;

  /**
   * Add an EpochShuffling to the ShufflingCache. If a promise for the shuffling is present it will
   * resolve the promise with the built shuffling
   */
  set(shuffling: EpochShuffling, decisionRoot: RootHex): void;
}

/**
 * Readonly interface for EpochShuffling.
 */
export type ReadonlyEpochShuffling = {
  readonly epoch: Epoch;
  readonly committees: Readonly<ValidatorIndex[][][]>;
};

export type EpochShuffling = {
  /**
   * Epoch being shuffled
   */
  epoch: Epoch;

  /**
   * Non-shuffled active validator indices
   */
  activeIndices: Uint32Array;

  /**
   * The active validator indices, shuffled into their committee
   */
  shuffling: Uint32Array;

  /**
   * List of list of committees Committees
   *
   * Committees by index, by slot
   *
   * Note: With a high amount of shards, or low amount of validators,
   * some shards may not have a committee this epoch
   */
  committees: Uint32Array[][];

  /**
   * Committees per slot, for fast attestation verification
   */
  committeesPerSlot: number;
};

export function computeCommitteeCount(activeValidatorCount: number): number {
  const validatorsPerSlot = intDiv(activeValidatorCount, SLOTS_PER_EPOCH);
  const committeesPerSlot = intDiv(validatorsPerSlot, TARGET_COMMITTEE_SIZE);
  return Math.max(1, Math.min(MAX_COMMITTEES_PER_SLOT, committeesPerSlot));
}

export function computeEpochShuffling(
  state: BeaconStateAllForks,
  activeIndices: ValidatorIndex[],
  activeValidatorCount: number,
  epoch: Epoch
): EpochShuffling {
  const seed = getSeed(state, epoch, DOMAIN_BEACON_ATTESTER);
  const _activeIndices = new Uint32Array(activeIndices);
  const shuffling = _activeIndices.slice();
  unshuffleList(shuffling, seed);

  const committeesPerSlot = computeCommitteeCount(activeValidatorCount);

  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;

  const committees: Uint32Array[][] = [];
  for (let slot = 0; slot < SLOTS_PER_EPOCH; slot++) {
    const slotCommittees: Uint32Array[] = [];
    for (let committeeIndex = 0; committeeIndex < committeesPerSlot; committeeIndex++) {
      const index = slot * committeesPerSlot + committeeIndex;
      const startOffset = Math.floor((activeValidatorCount * index) / committeeCount);
      const endOffset = Math.floor((activeValidatorCount * (index + 1)) / committeeCount);
      if (!(startOffset <= endOffset)) {
        throw new Error(`Invalid offsets: start ${startOffset} must be less than or equal end ${endOffset}`);
      }
      slotCommittees.push(shuffling.subarray(startOffset, endOffset));
    }
    committees.push(slotCommittees);
  }

  return {
    epoch,
    activeIndices: _activeIndices,
    shuffling,
    committees,
    committeesPerSlot,
  };
}

function getDecisionBlock(state: BeaconStateAllForks, epoch: Epoch): RootHex {
  const pivotSlot = computeStartSlotAtEpoch(epoch - 1) - 1;
  return toHexString(getBlockRootAtSlot(state, pivotSlot));
}

/**
 * Get the shuffling decision block root for the given epoch of given state
 *   - Special case close to genesis block, return the genesis block root
 *   - This is similar to forkchoice.getDependentRoot() function, otherwise we cannot get cached shuffing in attestation verification when syncing from genesis.
 */
export function getShufflingDecisionBlock(config: BeaconConfig, state: BeaconStateAllForks, epoch: Epoch): RootHex {
  return state.slot > GENESIS_SLOT
    ? getDecisionBlock(state, epoch)
    : toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(computeAnchorCheckpoint(config, state).blockHeader));
}
