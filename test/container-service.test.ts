import assert from "node:assert/strict";
import test from "node:test";
import { associateManagedContainers, type DockerSummary } from "../src/server/container-association.ts";
import type { TemplateRecord } from "../src/server/types.ts";

function template(name: string, fileName: string, icon: string | null = null): TemplateRecord {
  return { name, fileName, filePath: `/templates/${fileName}`, icon };
}

function deployed(name: string): DockerSummary {
  return {
    Id: `container-${name}`,
    Names: [`/${name}`],
    Image: `example/${name}:latest`,
    State: "running",
    Status: "Up 1 hour"
  };
}

test("associates a deployed container with a template by exact Name", () => {
  const containers = associateManagedContainers([template("plex", "my-plex.xml", "plex.png")], [deployed("plex")]);

  assert.equal(containers.length, 1);
  assert.equal(containers[0].name, "plex");
  assert.equal(containers[0].fileName, "my-plex.xml");
  assert.equal(containers[0].icon, "plex.png");
  assert.equal(containers[0].editable, true);
  assert.equal(containers[0].templateMatch, "name");
});

test("falls back to the Unraid template filename when Name differs", () => {
  const containers = associateManagedContainers([template("Sonarr archive", "my-sonarr.xml", "sonarr.png")], [deployed("sonarr")]);

  assert.equal(containers.length, 1);
  assert.equal(containers[0].name, "sonarr");
  assert.equal(containers[0].fileName, "my-sonarr.xml");
  assert.equal(containers[0].editable, true);
  assert.equal(containers[0].templateMatch, "file");
});

test("keeps a deployed container without a matching template visible but not editable", () => {
  const containers = associateManagedContainers([template("other", "my-other.xml", "other.png")], [deployed("unmatched")]);

  assert.equal(containers.length, 1);
  assert.equal(containers[0].name, "unmatched");
  assert.equal(containers[0].id, "container-unmatched");
  assert.equal(containers[0].fileName, null);
  assert.equal(containers[0].icon, null);
  assert.equal(containers[0].editable, false);
  assert.equal(containers[0].templateMatch, null);
});

test("does not include stale templates when their Docker container is not deployed", () => {
  const containers = associateManagedContainers(
    [template("active", "my-active.xml"), template("stale", "my-stale.xml")],
    [deployed("active")]
  );

  assert.deepEqual(containers.map((container) => container.name), ["active"]);
});

test("keeps Compose containers read-only even when a same-named template exists", () => {
  const compose = { ...deployed("sonarr"), Labels: { "com.docker.compose.project": "media" } };
  const containers = associateManagedContainers([template("sonarr", "my-sonarr.xml")], [compose]);

  assert.equal(containers[0].editable, false);
  assert.equal(containers[0].fileName, null);
  assert.equal(containers[0].uneditableReason, "compose");
});
