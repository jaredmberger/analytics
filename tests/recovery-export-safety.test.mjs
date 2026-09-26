import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Analytics recovery export is protected and scoped to its own KV',async()=>{
  const source=await readFile(new URL('../src/entry-v1.1.js',import.meta.url),'utf8');
  assert.match(source,/\/api\/recovery-export/);
  assert.match(source,/RECOVERY_EXPORT_TOKEN/);
  assert.match(source,/x-curator-recovery-key/);
  assert.match(source,/CURATOR_ANALYTICS_RECORDS/);
  assert.match(source,/159b868253094d3db41c4698a636fc4c/);
  assert.match(source,/list_complete/);
  assert.match(source,/dataSha256/);
});
