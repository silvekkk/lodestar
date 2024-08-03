import path from "node:path";
import {ModuleThread, spawn, Thread} from "@chainsafe/threads";
import {fromHexString} from "@chainsafe/ssz";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {LoggerNode} from "@lodestar/logger/node";
import {BeaconConfig, chainConfigToJson} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {StateGetOpts} from "../interface.js";
import {RegenCaller} from "../regen/interface.js";
import {QueuedStateRegenerator} from "../regen/queued.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {IBeaconDb} from "../../db/interface.js";
import {Metrics} from "../../metrics/index.js";
import {HistoricalStateRegen} from "./historicalState/index.js";
import {
  IStateManager,
  StateResponse,
  StateResponseRaw,
  StateManagerModules,
  StateManagerOptions,
  StateManagerWorkerApi,
  StateManagerWorkerData,
  StateStorageStrategy,
  IStateStorageStrategy,
} from "./interface.js";
import {StateSnapshotStrategy, StateDiffStrategy, StateEmptyStrategy} from "./strategies/index.js";

// Worker constructor consider the path relative to the current working directory
const WORKER_DIR = process.env.NODE_ENV === "test" ? "../../../lib/chain/historicalState" : "./";

export class StateManager implements IStateManager {
  readonly logger: LoggerNode;
  readonly forkChoice: IForkChoice;
  readonly regen: QueuedStateRegenerator;
  readonly db: IBeaconDb;
  readonly config: BeaconConfig;
  readonly metrics: Metrics | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly strategies: Record<StateStorageStrategy, IStateStorageStrategy<any>>;
  readonly opts: StateManagerOptions;

  // For now StateStore depends on `regen`, which is initialized in the BeaconChain constructor.
  // Due to that dependency we can not make the `constructor` method of this class private and only use `init`.
  // So we initialize the api (worker) in the `init` and assign to the object
  api?: ModuleThread<StateManagerWorkerApi>;
  historicalStateRegen?: HistoricalStateRegen;

  private signal?: AbortSignal;

  constructor(modules: StateManagerModules, opts: StateManagerOptions) {
    this.logger = modules.logger;
    this.forkChoice = modules.forkChoice;
    this.regen = modules.regen;
    this.db = modules.db;
    this.config = modules.config;
    this.metrics = modules.metrics;
    this.signal = modules.signal;
    this.opts = opts;

    const storageModules = {
      regen: this.regen,
      db: this.db,
      logger: this.logger,
      config: this.config,
    };

    const snapshotStrategy = new StateSnapshotStrategy(storageModules);
    const diffStrategy = new StateDiffStrategy(storageModules);
    const emptyStrategy = new StateEmptyStrategy(storageModules);

    this.strategies = {
      [StateStorageStrategy.Snapshot]: snapshotStrategy,
      [StateStorageStrategy.Diff]: diffStrategy,
      [StateStorageStrategy.Empty]: emptyStrategy,
    };

    this.signal?.addEventListener("abort", async () => this.close(), {once: true});
  }

  async init(): Promise<void> {
    const workerData: StateManagerWorkerData = {
      chainConfigJson: chainConfigToJson(this.config),
      genesisValidatorsRoot: this.config.genesisValidatorsRoot,
      genesisTime: this.opts.genesisTime,
      maxConcurrency: 1,
      maxLength: 50,
      dbLocation: this.opts.dbName,
      metricsEnabled: Boolean(this.metrics),
      loggerOpts: this.logger.toOpts(),
    };

    const worker = new Worker(path.join(WORKER_DIR, "worker.js"), {
      workerData,
    } as ConstructorParameters<typeof Worker>[1]);

    this.api = await spawn<StateManagerWorkerApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    });

    this.historicalStateRegen = await HistoricalStateRegen.init({
      opts: {
        genesisTime: this.opts.genesisTime,
        dbLocation: this.opts.dbName,
      },
      config: this.config,
      metrics: this.metrics,
      logger: this.logger.child({module: "chain"}),
      signal: this.signal,
    });
  }

  async close(): Promise<void> {
    if (!this.api) {
      return;
    }
    await this.api.close();
    this.logger.debug("Terminating state store worker");
    await Thread.terminate(this.api);
    this.logger.debug("Terminated state store worker");
  }

  async scrapeMetrics(): Promise<string> {
    return this.api ? this.api.scrapeMetrics() : "";
  }

  getHeadState(): CachedBeaconStateAllForks {
    // head state should always exist
    const head = this.forkChoice.getHead();
    const headState = this.regen.getClosestHeadState(head);
    if (!headState) {
      throw Error(`headState does not exist for head root=${head.blockRoot} slot=${head.slot}`);
    }
    return headState;
  }

  async getHeadStateAtEpoch(epoch: Epoch, regenCaller: RegenCaller): Promise<CachedBeaconStateAllForks> {
    // using getHeadState() means we'll use checkpointStateCache if it's available
    const headState = this.getHeadState();
    // head state is in the same epoch, or we pulled up head state already from past epoch
    if (epoch <= computeEpochAtSlot(headState.slot)) {
      // should go to this most of the time
      return headState;
    }
    // only use regen queue if necessary, it'll cache in checkpointStateCache if regen gets through epoch transition
    const head = this.forkChoice.getHead();
    const startSlot = computeStartSlotAtEpoch(epoch);
    return this.regen.getBlockSlotState(head.blockRoot, startSlot, {dontTransferCache: true}, regenCaller);
  }

  async getStateBySlot(slot: Slot, opts?: StateGetOpts): Promise<StateResponse | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();

    if (slot < finalizedBlock.slot) {
      // request for finalized state not supported in this API
      // fall back to caller to look in db or getHistoricalStateBySlot
      return null;
    }

    if (opts?.allowRegen) {
      // Find closest canonical block to slot, then trigger regen
      const block = this.forkChoice.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
      const state = await this.regen.getBlockSlotState(
        block.blockRoot,
        slot,
        {dontTransferCache: true},
        RegenCaller.restApi
      );
      return {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      };
    } else {
      // Just check if state is already in the cache. If it's not dialed to the correct slot,
      // do not bother in advancing the state. restApiCanTriggerRegen == false means do no work
      const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
      if (!block) {
        return null;
      }

      const state = this.regen.getStateSync(block.stateRoot);
      return (
        state && {
          state,
          executionOptimistic: isOptimisticBlock(block),
          finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
        }
      );
    }
  }

  async getHistoricalStateBySlot(slot: Slot): Promise<StateResponseRaw | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();

    if (slot >= finalizedBlock.slot) {
      return null;
    }

    // request for finalized state using historical state regen
    const stateSerialized = await this.historicalStateRegen?.getHistoricalState(slot);
    if (stateSerialized === undefined) {
      return null;
    }

    return {state: stateSerialized, executionOptimistic: false, finalized: true};
  }

  async getStateByStateRoot(stateRoot: RootHex, opts?: StateGetOpts): Promise<StateResponse | null> {
    if (opts?.allowRegen) {
      const state = await this.regen.getState(stateRoot, RegenCaller.restApi);
      const block = this.forkChoice.getBlock(state.latestBlockHeader.hashTreeRoot());
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: state.epochCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    // TODO: This can only fulfill requests for a very narrow set of roots.
    // - very recent states that happen to be in the cache
    // - 1 every 100s of states that are persisted in the archive state

    // TODO: This is very inneficient for debug requests of serialized content, since it deserializes to serialize again
    const cachedStateCtx = this.regen.getStateSync(stateRoot);
    if (cachedStateCtx) {
      const block = this.forkChoice.getBlock(cachedStateCtx.latestBlockHeader.hashTreeRoot());
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epochCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    const data = await this.db.stateArchive.getByRoot(fromHexString(stateRoot));
    return data && {state: data, executionOptimistic: false, finalized: true};
  }

  async getStateByCheckpoint(checkpoint: CheckpointWithHex): Promise<StateResponse | null> {
    // TODO: this is not guaranteed to work with new state caches, should work on this before we turn n-historical state on
    const cachedStateCtx = this.regen.getCheckpointStateSync(checkpoint);
    if (cachedStateCtx) {
      const block = this.forkChoice.getBlock(cachedStateCtx.latestBlockHeader.hashTreeRoot());
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epochCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    return null;
  }

  getStorageStrategies(slot: Slot): StateStorageStrategy[] {
    // We assume that one state can be stored with different strategies
    return Object.entries(this.strategies)
      .map(([key, value]) => {
        if (value.isSlotCompatible(slot)) return key;
        return false;
      })
      .filter(Boolean) as StateStorageStrategy[];
  }

  // TODO: For now this function will be used only for finalized state
  // later this should also process the hot states as well
  async storeState(checkpoint: CheckpointWithHex): Promise<void> {
    const slot = checkpoint.epoch * SLOTS_PER_EPOCH;

    for (const strategy of this.getStorageStrategies(slot)) {
      await this.strategies[strategy].store({slot, blockRoot: checkpoint.rootHex}, {strategies: this.strategies});
    }
  }
}
