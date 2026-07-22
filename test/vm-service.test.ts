import assert from "node:assert/strict";
import test from "node:test";
import { parseVmDomainXml, replaceVmMetadataIcon } from "../src/server/vm-service.ts";

test("reads Unraid vmtemplate icon metadata", () => {
  const xml = `<domain><name>Windows 11</name><uuid>01234567-89ab-cdef-0123-456789abcdef</uuid><metadata><vmtemplate xmlns="unraid" name="Windows 11" icon="windows11.png" os="windows11"/></metadata></domain>`;
  const parsed = parseVmDomainXml(xml);
  assert.equal(parsed.name, "Windows 11");
  assert.equal(parsed.id, "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(parsed.icon, "windows11.png");
});

test("changes only the VM icon attribute and preserves metadata", () => {
  const metadata = `<vmtemplate xmlns="unraid" name="Windows 11" icon="windows11.png" os="windows11" custom="kept"/>`;
  const changed = replaceVmMetadataIcon(metadata, `${"a".repeat(64)}.png`, "Windows 11");
  assert.match(changed, new RegExp(`icon="${"a".repeat(64)}\\.png"`));
  assert.match(changed, /custom="kept"/);
  assert.match(changed, /os="windows11"/);
});

test("creates safe Unraid metadata when a VM has none", () => {
  const created = replaceVmMetadataIcon(null, `${"b".repeat(64)}.png`, `A & "B"`);
  assert.match(created, /xmlns="unraid"/);
  assert.match(created, /name="A &amp; &quot;B&quot;"/);
});
