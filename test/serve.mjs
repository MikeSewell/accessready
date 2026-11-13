// Serves the demo pages until stopped (Ctrl-C), so the tool can be tried by hand:
//   node test/serve.mjs
//   node bin/accessready.mjs http://127.0.0.1:4173 /focus.html /obscured.html
// Each page under test/fixtures/site plants one kind of problem. PORT changes the port.
import { startSite } from './helpers.mjs';
const site = await startSite({}, Number(process.env.PORT) || 4173);
console.log(`Demo pages at ${site.origin}`);
