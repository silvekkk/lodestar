import {BeaconConfig} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Logger} from "@lodestar/logger";
import {Metrics} from "../../metrics/index.js";
import {IBeaconDb} from "../../db/interface.js";
import {QueuedStateRegenerator, RegenCaller} from "../regen/index.js";
import {StateGetOpts} from "../interface.js";

export type StateManagerWorkerData = {
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  maxConcurrency: number;
  maxLength: number;
  dbLocation: string;
  metricsEnabled: boolean;
  loggerOpts: LoggerNodeOpts;
};

export type StateManagerOptions = {
  genesisTime: number;
  dbName: string;
};

export type StateManagerModules = {
  db: IBeaconDb;
  regen: QueuedStateRegenerator;
  forkChoice: IForkChoice;
  config: BeaconConfig;
  logger: LoggerNode;
  metrics: Metrics | null;
  signal?: AbortSignal;
};

export type StateResponse = {
  state: BeaconStateAllForks;
  executionOptimistic: boolean;
  finalized: boolean;
};

export type StateResponseRaw = {
  state: Uint8Array;
  executionOptimistic: boolean;
  finalized: boolean;
};

export interface IStateManager {
  init(): Promise<void>;
  close(): Promise<void>;
  getHeadStateAtEpoch: (epoch: Epoch, regenCaller: RegenCaller) => Promise<CachedBeaconStateAllForks>;
  getHeadState(): CachedBeaconStateAllForks;
  getStateBySlot: (slot: Slot, opts?: StateGetOpts) => Promise<StateResponse | null>;
  getStateByStateRoot: (stateRoot: RootHex, opts?: StateGetOpts) => Promise<StateResponse | null>;
  getHistoricalStateBySlot: (slot: Slot) => Promise<StateResponseRaw | null>;
  getStateByCheckpoint: (checkpoint: CheckpointWithHex) => Promise<StateResponse | null>;
  storeState: (checkpoint: CheckpointWithHex) => Promise<void>;
  scrapeMetrics: () => Promise<string>;
}

export type StateManagerWorkerApi = {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
};

export enum StateStorageStrategy {
  Snapshot = "snapshot",
  Diff = "diff",
  Empty = "empty",
}

export type StateManagerStrategyModules = {
  regen: QueuedStateRegenerator;
  db: IBeaconDb;
  logger: Logger;
  config: BeaconConfig;
};

export type StorageStrategyContext = {
  getLastFullState: (slot: Slot) => Promise<{state: Uint8Array | null; slot: Slot}>;
};

export interface IStateStorageStrategy {
  isSlotCompatible: (slot: Slot) => boolean;
  getLastCompatibleSlot: (slot: Slot) => Slot;
  store: (opts: {slot: Slot; blockRoot: string}, context?: StorageStrategyContext) => Promise<void>;
  get: (slot: Slot, context?: StorageStrategyContext) => Promise<Uint8Array | null>;
}
