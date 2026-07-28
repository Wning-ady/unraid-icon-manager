import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { downloadRemoteImage, isPublicImageAddress, validateRemoteRaster } from "../src/server/remote-image-service.ts";

test("allows public image addresses and blocks local network targets", () => {
  assert.equal(isPublicImageAddress("1.1.1.1"), true);
  assert.equal(isPublicImageAddress("2606:4700:4700::1111"), true);
  for (const address of ["127.0.0.1", "10.0.0.2", "172.16.0.1", "192.168.2.21", "169.254.169.254", "100.64.0.1", "192.0.2.1", "240.0.0.1", "::1", "::127.0.0.1", "::7f00:1", "::ffff:7f00:1", "fd00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(isPublicImageAddress(address), false, address);
  }
});

test("rejects credentialed and private URL targets before connecting", async () => {
  await assert.rejects(downloadRemoteImage("http://user:pass@1.1.1.1/icon.png", 1024), /用户名或密码/);
  await assert.rejects(downloadRemoteImage("http://127.0.0.1/icon.png", 1024), /本机、局域网或保留地址/);
});

test("accepts remote raster bytes but rejects SVG even with a generic content type", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
  await validateRemoteRaster(png);
  await assert.rejects(validateRemoteRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>')), /不接受远程 SVG/);
});
