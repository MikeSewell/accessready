// The OCR worker is shared by the pages audited at the same time. A page that finishes must
// not shut it down while another page is still reading pictures with it: on a slow site that
// crashed the whole run with "Cannot read properties of null (reading 'postMessage')".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import '../src/index.mjs'; // loads the checks in their normal order
import { ocrLease } from '../src/checks/visual.mjs';

const blank = () => {
  const png = new PNG({ width: 120, height: 40 });
  png.data.fill(255);
  return PNG.sync.write(png);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a page that finishes does not shut the OCR worker down under a page still reading', async (t) => {
  let first;
  try {
    first = await ocrLease({ idle: 20 });
  } catch (e) {
    return t.skip(`OCR could not run here: ${e.message}`);
  }
  const second = await ocrLease({ idle: 20 });
  first.release();
  await wait(300); // well past the idle time
  const result = await second.worker.recognize(blank(), {}, { blocks: true });
  assert.ok(result.data, 'the second page could still read with the worker');
  second.release();
});

test('the OCR worker shuts down once the last page releases it, and a later page gets a new one', async (t) => {
  let a;
  try {
    a = await ocrLease({ idle: 20 });
  } catch (e) {
    return t.skip(`OCR could not run here: ${e.message}`);
  }
  a.release();
  a.release(); // releasing twice does not count twice
  await wait(300);
  const b = await ocrLease({ idle: 20 });
  assert.notEqual(b.worker, a.worker, 'a fresh worker after the old one was shut down');
  const result = await b.worker.recognize(blank(), {}, { blocks: true });
  assert.ok(result.data);
  b.release();
});
