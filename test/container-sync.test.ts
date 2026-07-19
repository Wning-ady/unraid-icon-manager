import assert from "node:assert/strict";
import test from "node:test";
import { recreateContainerWithIcon, updateComposeOverrideText } from "../src/server/container-sync-service.ts";

test("updates only the selected Compose Manager service icon label", () => {
  const source = [
    "services:",
    "  media:",
    "    labels:",
    "      net.unraid.docker.managed: 'composeman'",
    "      net.unraid.docker.icon: '/old/icon.png'",
    "      custom.keep: 'yes'",
    "    environment:",
    "      KEEP: value",
    "  database:",
    "    labels:",
    "      net.unraid.docker.icon: '/database.png'",
    ""
  ].join("\r\n");
  const next = updateComposeOverrideText(source, "media", "http://unraid:8787/api/icons/file/new.png");
  assert.match(next, /net\.unraid\.docker\.icon: 'http:\/\/unraid:8787\/api\/icons\/file\/new\.png'/);
  assert.match(next, /custom\.keep: 'yes'/);
  assert.match(next, /KEEP: value/);
  assert.match(next, /net\.unraid\.docker\.icon: '\/database\.png'/);
  assert.ok(next.includes("\r\n"));
});

test("adds a labels mapping when a Compose service has none", () => {
  const next = updateComposeOverrideText("services:\n  app:\n    image: example/app\n", "app", "https://example.com/icon.png");
  assert.match(next, / {2}app:\n {4}labels:\n {6}net\.unraid\.docker\.icon: 'https:\/\/example\.com\/icon\.png'\n {4}image:/);
  assert.throws(() => updateComposeOverrideText("services:\n  app:\n", "../app", "x"), /unsafe/);
});

function inspect(label = "/old/icon.png") {
  return {
    Id: "a".repeat(64), Name: "/target", State: { Running: true },
    Config: { Hostname: "a".repeat(12), Image: "example/app:latest", Labels: { "net.unraid.docker.icon": label }, Env: ["A=B"] },
    HostConfig: { Binds: ["/host:/config:rw"], NetworkMode: "bridge", RestartPolicy: { Name: "unless-stopped" } },
    Mounts: [{ Type: "volume", Name: "data-volume", Destination: "/data", RW: true }],
    NetworkSettings: { Networks: { bridge: { Aliases: null, Links: null, IPAMConfig: null, MacAddress: "" } } }
  };
}

test("recreates only the selected container with its new immutable icon label", async () => {
  const events: string[] = [];
  let createdOptions: any;
  const original = {
    inspect: async () => inspect(), stop: async () => { events.push("stop"); }, remove: async () => { events.push("remove-old"); }, start: async () => {}
  };
  const docker = {
    getContainer: () => original,
    createContainer: async (options: any) => {
      createdOptions = options; events.push("create-new");
      return { id: "new-id", start: async () => { events.push("start-new"); }, remove: async () => {}, stop: async () => {},
        inspect: async () => ({ Id: "new-id", Config: { Labels: options.Labels }, State: { Running: true } }) };
    }
  };
  const result = await recreateContainerWithIcon(docker as any, "old-id", "https://example.com/new.png");
  assert.equal(result.id, "new-id");
  assert.deepEqual(events, ["stop", "remove-old", "create-new", "start-new"]);
  assert.equal(createdOptions.Labels["net.unraid.docker.icon"], "https://example.com/new.png");
  assert.equal(createdOptions.HostConfig.Mounts[0].Source, "data-volume");
  assert.equal(createdOptions.HostConfig.RestartPolicy.Name, "unless-stopped");
});

test("recreates the original container automatically when replacement creation fails", async () => {
  const events: string[] = [];
  const original = {
    inspect: async () => inspect(), stop: async () => { events.push("stop"); }, remove: async () => { events.push("remove-old"); }, start: async () => {}
  };
  let attempts = 0;
  const docker = {
    getContainer: () => original,
    createContainer: async (options: any) => {
      attempts += 1;
      if (attempts === 1) throw new Error("replacement rejected");
      events.push(`restore:${options.Labels["net.unraid.docker.icon"]}`);
      return { start: async () => { events.push("start-restored"); }, remove: async () => {}, stop: async () => {}, inspect: async () => inspect() };
    }
  };
  await assert.rejects(recreateContainerWithIcon(docker as any, "old-id", "https://example.com/new.png"), /已自动恢复原容器/);
  assert.deepEqual(events, ["stop", "remove-old", "restore:/old/icon.png", "start-restored"]);
});
