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
    expect(body.data.map((a) => a.title)).toEqual([
      'Demo shop',
      'Odd shop',
      'Clean shop',
      'Media shop',
    ]);
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

  it("points the stories' media URLs at its own media files, which need no token", async () => {
    const stories = (
      await (await get('/story?story_group_id=3001', bearer)).json()
    ).data;
    expect(stories.map((s) => s.media)).toEqual(
      [1, 2, 3].map((n) => `${fake.mediaUrl}/story-400${n}.jpg`),
    );
    const media = await fetch(stories[0].media);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/jpeg');
    const bytes = new Uint8Array(await media.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('serves a file of each type, and the failing media of Media shop', async () => {
    const types = {};
    for (const ext of ['png', 'gif', 'webp', 'mp4', 'webm']) {
      types[ext] = (await fetch(`${fake.mediaUrl}/story-1.${ext}`)).headers.get(
        'content-type',
      );
    }
    expect(types).toEqual({
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
    });

    const stories = (
      await (await get('/story?story_group_id=3301', bearer)).json()
    ).data;
    expect(stories).toHaveLength(14);
    expect(stories.find((s) => s.title === 'File').media).toBe(
      'file:///etc/passwd',
    );

    const manual = { redirect: 'manual' };
    expect(
      (
        await fetch(`${fake.mediaUrl}/redirect-private.jpg`, manual)
      ).headers.get('location'),
    ).toBe('http://169.254.169.254/latest/meta-data/');
    expect(
      (
        await fetch(`${fake.mediaUrl}/redirect-loopback.jpg`, manual)
      ).headers.get('location'),
    ).toMatch(/^http:\/\/\[::1\]:/);
    expect((await fetch(`${fake.mediaUrl}/moved.jpg`)).status).toBe(200);
    expect((await fetch(`${fake.mediaUrl}/missing.jpg`)).status).toBe(404);
    expect(
      (await fetch(`${fake.mediaUrl}/octet.png`)).headers.get('content-type'),
    ).toBe('application/octet-stream');
    expect(
      await (await fetch(`${fake.mediaUrl}/wrong-type.jpg`)).text(),
    ).toMatch(/<!doctype html>/);

    const large = await fetch(`${fake.mediaUrl}/too-large.jpg`);
    expect(large.headers.get('content-length')).toBeNull();
    expect((await large.arrayBuffer()).byteLength).toBe(10 * 1024 * 1024 + 1);
    const declared = await fetch(`${fake.mediaUrl}/too-large-declared.mp4`);
    expect(declared.headers.get('content-length')).toBe(
      String(100 * 1024 * 1024 + 1),
    );
    await declared.body.cancel();
  });
});
