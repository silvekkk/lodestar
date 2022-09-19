import path from "node:path";
import {getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {Root} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {getGlobalPaths} from "../../paths/global.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const logger = getCliLogger(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config);
  const {beaconApiUrl} = args;
  const api = getClient({baseUrl: beaconApiUrl}, {config});
  const {data: genesisData} = await api.beacon.getGenesis();

  let checkpointRoot: Root;
  if (args.checkpointRoot) {
    checkpointRoot = fromHexString(args.checkpointRoot);
  } else {
    logger.warn("Fetching latest finalized checkpoint. Use checkpointRoot option to specify a trusted root");
    const {data} = await api.beacon.getStateFinalityCheckpoints("head");
    checkpointRoot = data.finalized.root;
  }

  const client = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    beaconApiUrl,
    genesisData: {
      genesisTime: Number(genesisData.genesisTime),
      genesisValidatorsRoot: genesisData.genesisValidatorsRoot,
    },
    checkpointRoot,
  });

  client.start();
}
