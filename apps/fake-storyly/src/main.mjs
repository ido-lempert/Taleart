// Runs the fake Storyly server for local reviews: `nx run fake-storyly:serve`
// (port 4400). Point the API at it with STORYLY_API_URL=http://localhost:4400/external
// and use the token fake-storyly-token.
import { FAKE_STORYLY_TOKEN, startFakeStoryly } from './fake-storyly.mjs';

const port = Number(process.env.PORT) || 4400;
const fake = await startFakeStoryly({ port, host: 'localhost' });
console.log(JSON.stringify({ level: 'info', msg: `Fake Storyly at ${fake.url}; test token ${FAKE_STORYLY_TOKEN}` }));
