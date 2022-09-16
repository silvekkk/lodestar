import {expect} from "chai";
import {getTestdirPath} from "../../utils.js";
import {createPeerId, writePeerId, readPeerId, toUint8ArrayPeerId} from "../../../src/config/index.js";

describe("config / peerId", () => {
  const peerIdFilepath = getTestdirPath("./test-peer-id.json");

  it("create, write and read PeerId", async () => {
    const peerId = await createPeerId();
    writePeerId(peerIdFilepath, peerId);
    const peerIdRead = await readPeerId(peerIdFilepath);

    expect(peerIdRead.toB58String()).to.equal(peerId.toB58String());
  });

  it("should create the same peer id using toUint8ArrayPeerId", async () => {
    const peerId = await createPeerId();
    const peerId2 = await toUint8ArrayPeerId(peerId);
    expect(peerId.equals(peerId2)).to.be.true;
  });
});
