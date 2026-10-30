import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// The two guides the page offers are copies: the guide of the local mode lives in
// the planner, which packs it into its installer, the other one in the MCP service.
const site = (path) => new URL(`../site/${path}`, import.meta.url);
const read = (url) => fs.readFileSync(url, 'utf8').replace(/\r\n/g, '\n');

const copies = [
  ['docs/mcp-local.md', '../../Calendar/docs/MCP.md'],
  ['docs/mcp-web.md', '../../CalendarWebMCP/docs/MCP-Web.md'],
];

for (const [copy, source] of copies) {
  const original = new URL(source, import.meta.url);
  test(`${copy} совпадает с оригиналом`, { skip: !fs.existsSync(original) }, () => {
    assert.equal(read(site(copy)), read(original));
  });
}

test('в карточке агента есть ссылки на обе инструкции', () => {
  const page = read(site('index.html'));
  for (const [copy] of copies) {
    assert.match(page, new RegExp(`<a [^>]*href="${copy}"[^>]*download`));
    assert.ok(fs.existsSync(site(copy)));
  }
});
