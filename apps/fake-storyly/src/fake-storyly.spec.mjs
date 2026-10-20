import { FAKE_STORYLY_TOKEN, startFakeStoryly } from './fake-storyly.mjs';

describe('fake Storyly server', () => {
  let fake;
  beforeAll(async () => {
    fake = await startFakeStoryly();
  });
  afterAll(() => fake.close());
  beforeEach(() => {
    fake.control.failInstances = null;
  });

  const get = (path, init) => fetch(`${fake.url}${path}`, init);
  const bearer = { headers: { Authorization: `Bearer ${FAKE_STORYLY_TOKEN}` } };

  it('lists the one app for the test token, as a bearer token or the token parameter', async () => {
    const res = await get('/app', bearer);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((a) => a.title)).toEqual(['Demo shop']);
    expect((await get(`/app?token=${FAKE_STORYLY_TOKEN}`)).status).toBe(200);
  });

  it('refuses any other token', async () => {
    expect((await get('/app', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await get('/app')).status).toBe(401);
  });

  it("lists the app's three instances", async () => {
    const body = await (await get('/instance?app_id=1001', bearer)).json();
    expect(body.data.map((i) => i.title)).toEqual(['Home page', 'Product page', 'Checkout']);
  });

  it('fails the instances list on request', async () => {
    fake.control.failInstances = 'status';
    expect((await get('/instance?app_id=1001', bearer)).status).toBe(500);
    fake.control.failInstances = 'shape';
    expect(await (await get('/instance?app_id=1001', bearer)).json()).toEqual({ instances: 'unexpected' });
  });

  it('never accepts a write', async () => {
    expect((await get('/app', { ...bearer, method: 'POST' })).status).toBe(405);
  });
});
