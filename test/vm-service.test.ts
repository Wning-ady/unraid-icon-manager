import assert from "node:assert/strict";
import test from "node:test";
import { parseVmDomainXml, replaceVmMetadataIcon, UNRAID_VM_METADATA_URI } from "../src/server/vm-service.ts";

test("uses the namespace required by Unraid 7", () => {
  assert.equal(UNRAID_VM_METADATA_URI, "http://unraid");
});

test("reads Unraid vmtemplate icon metadata", () => {
  const xml = `<domain><name>Windows 11</name><uuid>01234567-89ab-cdef-0123-456789abcdef</uuid><metadata><vmtemplate xmlns="http://unraid" name="Windows 11" icon="windows11.png" os="windows11"/></metadata></domain>`;
  const parsed = parseVmDomainXml(xml);
  assert.equal(parsed.name, "Windows 11");
  assert.equal(parsed.id, "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(parsed.icon, "windows11.png");
});

test("changes only the VM icon attribute and preserves metadata", () => {
  const metadata = `<vmtemplate xmlns="http://unraid" name="Windows 11" icon="windows11.png" iconold="windows.png" os="windows11" webui="https://example.test" storage="default" custom="kept"/>`;
  const changed = replaceVmMetadataIcon(metadata, `${"a".repeat(64)}.png`, "Windows 11");
  assert.match(changed, new RegExp(`icon="${"a".repeat(64)}\\.png"`));
  assert.match(changed, /custom="kept"/);
  assert.match(changed, /os="windows11"/);
  assert.match(changed, /iconold="windows.png"/);
  assert.match(changed, /webui="https:\/\/example.test"/);
  assert.match(changed, /storage="default"/);
});

test("creates safe Unraid metadata when a VM has none", () => {
  const created = replaceVmMetadataIcon(null, `${"b".repeat(64)}.png`, `A & "B"`);
  assert.match(created, /xmlns="http:\/\/unraid"/);
  assert.match(created, /name="A &amp; &quot;B&quot;"/);
});
