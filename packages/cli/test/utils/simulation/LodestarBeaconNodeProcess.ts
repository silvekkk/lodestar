import {ChildProcess} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import {nodeUtils} from "@lodestar/beacon-node/node";
import type {SecretKey} from "@chainsafe/bls/types";
import {Api, getClient} from "@lodestar/api";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {getBeaconConfigFromArgs} from "../../../src/config/beaconParams.js";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {BeaconNodeConstructor, BeaconNodeProcess, SimulationParams, ValidatorProcess} from "./types.js";
import {closeChildProcess, spawnProcessAndWait, __dirname} from "./utils.js";
import {LodestarValidatorProcess} from "./LodestarValidatorProcess.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LodestarBeaconNodeProcess: BeaconNodeConstructor = class LodestarBeaconNodeProcess
  implements BeaconNodeProcess {
  static totalProcessCount = 0;
  readonly params: SimulationParams;
  api!: Api;
  readonly secretKeys: Record<number, SecretKey[]> = {};
  readonly address: string;
  readonly port: number;
  readonly restPort: number;

  private rootDir: string;
  private beaconProcess!: ChildProcess;
  private validatorProcesses: ValidatorProcess[] = [];
  private rcConfig: IBeaconArgs & IGlobalArgs;

  constructor(params: SimulationParams, rootDir: string) {
    this.params = params;
    this.rootDir = rootDir;
    LodestarBeaconNodeProcess.totalProcessCount += 1;

    this.address = "127.0.0.1";
    this.port = 4000 + LodestarBeaconNodeProcess.totalProcessCount;
    this.restPort = 5000 + LodestarBeaconNodeProcess.totalProcessCount;

    this.rcConfig = ({
      network: "dev",
      preset: "minimal",
      dataDir: this.rootDir,
      genesisStateFile: `${this.rootDir}/genesis.ssz`,
      rest: true,
      "rest.address": this.address,
      "rest.port": this.restPort,
      "sync.isSingleNode": true,
      "network.allowPublishToZeroPeers": true,
      eth1: false,
      discv5: false,
      listenAddress: this.address,
      port: this.port,
      metrics: false,
      dev: true,
      "params.SECONDS_PER_SLOT": String(this.params.secondsPerSlot),
      "params.GENESIS_DELAY": String(this.params.genesisSlotsDelay),
      "params.ALTAIR_FORK_EPOCH": String(this.params.altairEpoch),
      "params.BELLATRIX_FORK_EPOCH": String(this.params.bellatrixEpoch),
    } as unknown) as IBeaconArgs & IGlobalArgs;
  }

  async start(): Promise<void> {
    await mkdir(this.rootDir);
    const {state} = nodeUtils.initDevState(getBeaconConfigFromArgs(this.rcConfig), this.params.validatorClients, {
      genesisTime: this.params.genesisTime,
    });
    await writeFile(`${this.rootDir}/genesis.ssz`, state.serialize());

    this.api = getClient(
      {baseUrl: `http://${this.address}:${this.restPort}/`},
      {config: getBeaconConfigFromArgs(this.rcConfig)}
    );

    await writeFile(`${this.rootDir}/rc_config.json`, JSON.stringify(this.rcConfig, null, 2));
    this.beaconProcess = await spawnProcessAndWait(
      `${__dirname}/../../../bin/lodestar.js`,
      ["beacon", "--rcConfig", `${this.rootDir}/rc_config.json`, "--network", "dev", "--dev", "true"],
      async () => this.ready(),
      "Waiting for beacon node to start..."
    );

    for (let clientIndex = 0; clientIndex < this.params.validatorClients; clientIndex++) {
      this.validatorProcesses.push(
        new LodestarValidatorProcess(this.params, {
          rootDir: this.rootDir,
          config: getBeaconConfigFromArgs(this.rcConfig),
          server: `http://${this.address}:${this.restPort}/`,
          clientIndex,
        })
      );
      await this.validatorProcesses[this.validatorProcesses.length - 1].start();
    }
  }

  async stop(): Promise<void> {
    if (this.beaconProcess !== undefined) {
      await closeChildProcess(this.beaconProcess);
    }

    await Promise.all(this.validatorProcesses.map((p) => p.stop()));
  }

  async ready(): Promise<boolean> {
    const health = await this.api.node.getHealth();

    return health === 200 || health === 206;
  }
};
