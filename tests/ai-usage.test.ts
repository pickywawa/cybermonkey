import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { UsageLedger } from '../src/main/infra/ai/usage.js';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'cm-usage-'));

test('usage ledger: tokens are summed per day, week and in total', async () => {
  const dir = await temp();
  const file = path.join(dir, 'ai-usage.json');
  const ledger = new UsageLedger(file);
  const now = new Date('2026-11-05T12:00:00Z');
  await ledger.add({ input: 100, output: 10 }, now);
  await ledger.add({ input: 50, output: 5 }, now);
  await ledger.add({ input: 1000, output: 100 }, new Date('2026-11-01T12:00:00Z')); // within 7 days
  await ledger.add({ input: 7000, output: 700 }, new Date('2026-10-01T12:00:00Z')); // older
  const totals = await ledger.totals(now);
  assert.deepEqual(totals.today, { input: 150, output: 15 });
  assert.deepEqual(totals.week, { input: 1150, output: 115 });
  assert.deepEqual(totals.total, { input: 8150, output: 815 });
  // Survives a restart.
  const again = new UsageLedger(file);
  assert.deepEqual((await again.totals(now)).total, { input: 8150, output: 815 });
  await fs.rm(dir, { recursive: true, force: true });
});

test('usage ledger: a damaged file starts over instead of failing, empty usage writes nothing', async () => {
  const dir = await temp();
  const file = path.join(dir, 'ai-usage.json');
  await fs.writeFile(file, '{ not json');
  const ledger = new UsageLedger(file);
  assert.deepEqual((await ledger.totals()).total, { input: 0, output: 0 });
  await ledger.add({ input: 0, output: 0 });
  assert.equal(await fs.readFile(file, 'utf8'), '{ not json');
  await fs.rm(dir, { recursive: true, force: true });
});
