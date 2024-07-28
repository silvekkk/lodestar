import {BeaconConfig} from "@lodestar/config";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Metrics} from "../../../metrics/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {QueuedStateRegenerator, RegenCaller} from "../../regen/index.js";
import {StateGetOpts} from "../../interface.js";
import {HistoricalStateRegen} from "../../historicalState/index.js";

export type StateStoreWorkerData = {
  chainConfigJson: Record<string, string>;
  genesisValidatorsRoot: Uint8Array;
  genesisTime: number;
  maxConcurrency: number;
  maxLength: number;
  dbLocation: string;
  metricsEnabled: boolean;
  loggerOpts: LoggerNodeOpts;
};

export type StateStoreOptions = {
  genesisTime: number;
  dbName: string;
};

export type StateStoreModules = {
  db: IBeaconDb;
  regen: QueuedStateRegenerator;
  historicalStateRegen?: HistoricalStateRegen;
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

export interface IStateStore {
  init(): Promise<void>;
  close(): Promise<void>;
  getHeadStateAtEpoch: (epoch: Epoch, regenCaller: RegenCaller) => Promise<CachedBeaconStateAllForks>;
  getHeadState(): CachedBeaconStateAllForks;
  getStateBySlot: (slot: Slot, opts?: StateGetOpts) => Promise<StateResponse | null>;
  getStateByStateRoot: (stateRoot: RootHex, opts?: StateGetOpts) => Promise<StateResponse | null>;
  getHistoricalStateBySlot: (slot: Slot) => Promise<StateResponseRaw | null>;
  getStateByCheckpoint: (checkpoint: CheckpointWithHex) => Promise<StateResponse | null>;
  scrapeMetrics: () => Promise<string>;
}

export type StateStoreWorkerApi = {
  close(): Promise<void>;
  scrapeMetrics(): Promise<string>;
};
