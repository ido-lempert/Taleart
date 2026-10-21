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

  it('lists the apps for the test token, as a bearer token or the token parameter', async () => {
    const res = await get('/app', bearer);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((a) => a.title)).toEqual(['Demo shop', 'Odd shop', 'Clean shop']);
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

  it('answers after delayMs, until reset', async () => {
    fake.control.delayMs = 120;
    let began = Date.now();
    expect((await get('/app', bearer)).status).toBe(200);
    expect(Date.now() - began).toBeGreaterThanOrEqual(100);
    fake.control.reset();
    expect(fake.control.delayMs).toBe(0);
    began = Date.now();
    await get('/app', bearer);
    expect(Date.now() - began).toBeLessThan(100);
  });

  it('never accepts a write', async () => {
    expect((await get('/app', { ...bearer, method: 'POST' })).status).toBe(405);
  });

  it('serves Odd shop with malformed and unmappable records, and Clean shop with records of the expected shape', async () => {
    const odd = (await (await get('/instance?app_id=1002', bearer)).json()).data;
    expect(odd).toEqual([expect.objectContaining({ id: 2101, name: 'Odd home' }), 'oops', expect.not.objectContaining({ id: expect.anything() })]);
    const oddGroups = (await (await get('/story-group?instance_id=2101', bearer)).json()).data;
    expect(oddGroups.map((g) => g.id)).toEqual([3101, 3102]);
    expect(oddGroups[0]).toMatchObject({ click_target_cap: 5, theme: 'dark', pinned: true });
    const oddStories = (await (await get('/story?story_group_id=3101', bearer)).json()).data;
    expect(oddStories[0]).toMatchObject({ deep_link: expect.any(String), button_text: 'Shop now' });
    expect(oddStories[1]).toHaveProperty('sortOrder');
    expect(oddStories[1]).not.toHaveProperty('sort_order');
    expect(oddStories[2]).toBeNull();

    const clean = (await (await get('/instance?app_id=1003', bearer)).json()).data;
    expect(clean.map((i) => i.title)).toEqual(['Clean home']);
    const cleanStories = (await (await get('/story?story_group_id=3201', bearer)).json()).data;
    expect(cleanStories.map((s) => s.title)).toEqual(['Fresh today', 'Weekend menu']);
  });
});
