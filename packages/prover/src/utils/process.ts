import {Logger} from "@lodestar/logger";
import {ELRequestHandler, ELVerifiedRequestHandler} from "../interfaces.js";
import {ProofProvider} from "../proof_provider/proof_provider.js";
import {ELRequestPayload, ELResponse} from "../types.js";
import {eth_getBalance} from "../verified_requests/eth_get_balance.js";
import {eth_getTransactionCount} from "../verified_requests/eth_get_transaction_count.js";
import {eth_getBlockByHash} from "../verified_requests/eth_get_block_by_hash.js";
import {eth_getBlockByNumber} from "../verified_requests/eth_get_block_by_number.js";
import {eth_getCode} from "../verified_requests/eth_get_code.js";
import {eth_call} from "../verified_requests/eth_call.js";
import {eth_estimateGas} from "../verified_requests/eth_estimate_gas.js";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
export const supportedELRequests: Record<string, ELVerifiedRequestHandler<any, any>> = {
  eth_getBalance: eth_getBalance,
  eth_getTransactionCount: eth_getTransactionCount,
  eth_getBlockByHash: eth_getBlockByHash,
  eth_getBlockByNumber: eth_getBlockByNumber,
  eth_getCode: eth_getCode,
  eth_call: eth_call,
  eth_estimateGas: eth_estimateGas,
};
/* eslint-enable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any*/

export async function processAndVerifyRequest({
  payload,
  handler,
  proofProvider,
  logger,
}: {
  payload: ELRequestPayload;
  handler: ELRequestHandler;
  proofProvider: ProofProvider;
  logger: Logger;
}): Promise<ELResponse | undefined> {
  await proofProvider.waitToBeReady();
  logger.debug("Processing request", {method: payload.method, params: JSON.stringify(payload.params)});
  const verifiedHandler = supportedELRequests[payload.method];

  if (verifiedHandler !== undefined) {
    logger.debug("Verified request handler found", {method: payload.method});
    return verifiedHandler({payload, handler, proofProvider, logger});
  }

  logger.warn("Verified request handler not found. Falling back to proxy.", {method: payload.method});
  return handler(payload);
}
