// Runs the fake Storyly server for local reviews: `nx run fake-storyly:serve`
// (port 4400). Point the API at it with STORYLY_API_URL=http://localhost:4400/external
// and use the token fake-storyly-token. It serves three apps: Demo shop (the
// usual account), Odd shop (malformed and unmappable records, whose report
// lists every difference) and Clean shop (records of the expected shape, no
// differences).
// FAKE_STORYLY_DELAY_MS slows every answer, so an import's progress can be
// watched; FAKE_STORYLY_FAIL (instances, story-groups or stories) answers that
// list with a 500, so a failed import can be seen.
import { FAKE_STORYLY_TOKEN, startFakeStoryly } from './fake-storyly.mjs';

const FAIL_SWITCHES = { instances: 'failInstances', 'story-groups': 'failStoryGroups', stories: 'failStories' };

const port = Number(process.env.PORT) || 4400;
const fake = await startFakeStoryly({ port, host: 'localhost' });
fake.control.delayMs = Math.max(0, Number(process.env.FAKE_STORYLY_DELAY_MS) || 0);
const fail = FAIL_SWITCHES[process.env.FAKE_STORYLY_FAIL ?? ''];
if (fail) fake.control[fail] = 'status';
console.log(
  JSON.stringify({
    level: 'info',
    msg: `Fake Storyly at ${fake.url}; test token ${FAKE_STORYLY_TOKEN}`,
    delayMs: fake.control.delayMs,
    fail: fail ?? null,
  }),
);
