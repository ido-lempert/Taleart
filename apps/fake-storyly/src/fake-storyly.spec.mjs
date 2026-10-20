import { FAKE_STORYLY_TOKEN, startFakeStoryly } from './fake-storyly.mjs';

describe('fake Storyly server', () => {
  let fake;
  beforeAll(async () => {
    fake = await startFakeStoryly();
  });
  afterAll(() => fake.close());
  beforeEach(() => {
    fake.control.reset();
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
    expect(await (await get('/instance?app_id=1001', bearer)).json()).toEqual({ unexpected: true });
  });

  it("lists each instance's story groups, six in all, out of sort order", async () => {
    const counts = [];
    for (const instanceId of ['2001', '2002', '2003']) {
      const body = await (await get(`/story-group?instance_id=${instanceId}`, bearer)).json();
      expect(body.data.every((g) => g.instance_id === Number(instanceId))).toBe(true);
      counts.push(body.data.length);
    }
    expect(counts).toEqual([3, 2, 1]);
    const home = await (await get('/story-group?instance_id=2001', bearer)).json();
    expect(home.data.map((g) => g.sort_order)).toEqual([2, 0, 1]);
    expect(await (await get('/story-group?instance_id=9999', bearer)).json()).toEqual({ data: [] });
  });

  it("lists a story group's stories, fifteen in all", async () => {
    let total = 0;
    for (const instanceId of ['2001', '2002', '2003']) {
      const groups = await (await get(`/story-group?instance_id=${instanceId}`, bearer)).json();
      for (const group of groups.data) {
        const stories = await (await get(`/story?story_group_id=${group.id}`, bearer)).json();
        expect(stories.data.every((s) => s.story_group_id === group.id && typeof s.sort_order === 'number')).toBe(true);
        total += stories.data.length;
      }
    }
    expect(total).toBe(15);
  });

  it('fails the story group and story lists on request, and serves changed data until reset', async () => {
    fake.control.failStoryGroups = 'status';
    expect((await get('/story-group?instance_id=2001', bearer)).status).toBe(500);
    fake.control.failStories = 'shape';
    expect(await (await get('/story?story_group_id=3001', bearer)).json()).toEqual({ unexpected: true });
    fake.control.reset();
    fake.control.data.stories['3001'].data.pop();
    expect((await (await get('/story?story_group_id=3001', bearer)).json()).data).toHaveLength(2);
    fake.control.reset();
    expect((await (await get('/story?story_group_id=3001', bearer)).json()).data).toHaveLength(3);
  });

  it('never accepts a write', async () => {
    expect((await get('/app', { ...bearer, method: 'POST' })).status).toBe(405);
  });
});
