import assert from "node:assert/strict";
import test from "node:test";
import { getTemplateIcon, getTemplateName, setTemplateIcon } from "../src/server/template-service.ts";

const template = `<?xml version="1.0"?><Container version="2"><Name>plex</Name><Unknown hello="world">keep me</Unknown><Icon>https://old.example/icon.png</Icon><Config Name="Data">/mnt/data</Config></Container>`;

test("replaces only the Icon value and preserves unknown fields", () => {
  const result = setTemplateIcon(template, "https://new.example/icon?a=1&b=2");
  assert.match(result, /<Unknown hello="world">keep me<\/Unknown>/);
  assert.match(result, /<Config Name="Data">\/mnt\/data<\/Config>/);
  assert.equal(getTemplateIcon(result), "https://new.example/icon?a=1&b=2");
});

test("adds an Icon field without removing existing XML", () => {
  const xml = "<Container><Name>radarr</Name><Config Name=\"Port\">7878</Config></Container>";
  const result = setTemplateIcon(xml, "/mnt/user/icons/radarr.png");
  assert.match(result, /<Config Name="Port">7878<\/Config>/);
  assert.equal(getTemplateIcon(result), "/mnt/user/icons/radarr.png");
});

test("derives template names without allowing XML fields to alter paths", () => {
  assert.equal(getTemplateName(template, "my-other.xml"), "plex");
  assert.equal(getTemplateName("<Container></Container>", "my-sonarr.xml"), "sonarr");
});
