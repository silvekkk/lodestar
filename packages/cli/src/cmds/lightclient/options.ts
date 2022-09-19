import {logOptions} from "../../options/logOptions.js";
import {ICliCommandOptions, ILogArgs} from "../../util/index.js";

export type ILightClientArgs = ILogArgs & {
  beaconApiUrl: string;
  checkpointRoot?: string;
};

export const lightclientOptions: ICliCommandOptions<ILightClientArgs> = {
  ...logOptions,

  beaconApiUrl: {
    description: "Url to a beacon node that support lightclient API",
    type: "string",
    default: "http://127.0.0.1:9596",
  },

  checkpointRoot: {
    description: "Checkpoint root hex string to sync the lightclient from, start with 0x",
    type: "string",
  },
};
