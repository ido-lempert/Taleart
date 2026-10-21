// The Scale shop: a generated account for the importer's throughput target
// (importer story 10). Everything is derived from the profile in
// fixtures/scale-profile.json and the record ids, so two runs serve the same
// records, sizes, delays and failures. No Storyly docs text, real tokens or
// end-user identifiers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dirname, 'fixtures');

/** The profile as committed: what the throughput target measures against. */
export function loadScaleProfile() {
  return JSON.parse(readFileSync(join(fixturesDir, 'scale-profile.json'), 'utf8'));
}

/** A number in [0, 1) from a key, the same on every run (FNV-1a). */
export function hash01(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // A final mix (murmur3's), so keys that differ in one digit spread evenly.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** A whole number in [min, max] picked by `key`. */
export const pick = ([min, max], key) => Math.round(min + (max - min) * hash01(key));

// The leading bytes of each kind, enough for the importer's type check; the rest of a file is zeros.
const mediaDir = join(fixturesDir, 'media');
const HEADERS = {
  jpg: readFileSync(join(mediaDir, 'story-0.jpg')).subarray(0, 64),
  mp4: readFileSync(join(mediaDir, 'story.mp4')),
};
export const SCALE_MEDIA_TYPES = { jpg: 'image/jpeg', mp4: 'video/mp4' };
const FIXTURE_MEDIA_BASE = 'https://media.example/fake/';
const stamp = '2026-09-01 10:00:00';

/**
 * The Scale shop's records and media files: `instances` instances, each with
 * `groupsPerInstance` story groups of `storiesPerGroup` stories, every story
 * with an image or (a `videoShare` of them) a video of a size picked from the
 * profile's ranges. Groups carry `labelsPerGroup` of the app's `labels` labels.
 */
export function scaleData(profile) {
  const appId = String(profile.app.id);
  const instances = [];
  const storyGroups = {};
  const stories = {};
  const media = new Map();
  const labels = Array.from({ length: profile.labels }, (_, i) => ({
    id: 95000 + i,
    app_id: profile.app.id,
    account_id: 501,
    name: `scale-label-${i + 1}`,
    ts_created: stamp,
    ts_updated: stamp,
  }));
  let groupId = 910000;
  let storyId = 920000;
  for (let i = 0; i < profile.instances; i++) {
    const instanceId = 90100 + i;
    instances.push({
      id: instanceId,
      app_id: profile.app.id,
      title: `Scale zone ${i + 1}`,
      token: `fake-instance-token-${instanceId}`,
      platform: 'web',
    });
    const groups = [];
    for (let g = 0; g < profile.groupsPerInstance; g++) {
      const id = groupId++;
      const segments = Array.from(
        { length: profile.labelsPerGroup },
        (_, l) => labels[(g + l * 7) % labels.length].name,
      );
      groups.push({
        id,
        app_id: profile.app.id,
        instance_id: instanceId,
        account_id: 501,
        title: `Scale group ${id}`,
        status: 1,
        sort_order: g,
        pinned: false,
        segments,
        settings: {},
        media: null,
        ts_start: null,
        ts_end: null,
        ts_created: stamp,
        ts_updated: stamp,
      });
      const list = [];
      for (let s = 0; s < profile.storiesPerGroup; s++) {
        const sid = storyId++;
        const video = hash01(`kind:${sid}`) < profile.media.videoShare;
        const ext = video ? 'mp4' : 'jpg';
        const name = `scale-${sid}.${ext}`;
        media.set(name, {
          ext,
          bytes: pick(video ? profile.media.videoBytes : profile.media.imageBytes, `size:${sid}`),
        });
        list.push({
          id: sid,
          story_group_id: id,
          account_id: 501,
          title: `Scale story ${sid}`,
          name: `Scale story ${sid}`,
          type: 1,
          status: 1,
          sort_order: s,
          media: `${FIXTURE_MEDIA_BASE}${name}`,
          media_raw: null,
          studio_image: null,
          mime_type: SCALE_MEDIA_TYPES[ext],
          thumbnail: null,
          deep_link: null,
          outlink: null,
          button_text: null,
          settings: {},
          target_cap: null,
          ts_created: stamp,
          ts_start: null,
          ts_updated: stamp,
          ts_end: null,
        });
      }
      stories[String(id)] = { data: list };
    }
    storyGroups[String(instanceId)] = { data: groups };
  }
  return {
    app: {
      id: profile.app.id,
      token: `fake-app-token-${appId}`,
      title: profile.app.title,
      category: 'shopping',
      store_type: 'web',
      store_id: 'scale-shop.example',
      account_id: 501,
      is_inbox_story: false,
      settings: {},
      detailed_info: {},
    },
    instances: { [appId]: { data: instances } },
    storyGroups,
    stories,
    segments: { [appId]: { data: labels } },
    media,
  };
}

/**
 * Sends a Scale shop media file: its kind's leading bytes then zeros, `total`
 * bytes with a Content-Length, paced at `bytesPerSecond`, until it ends or the
 * client goes away.
 */
export function sendPaced(res, ext, total, bytesPerSecond) {
  res.writeHead(200, { 'Content-Type': SCALE_MEDIA_TYPES[ext], 'Content-Length': String(total) });
  const size = 64 * 1024;
  const zeros = Buffer.alloc(size);
  const first = Buffer.alloc(Math.min(size, total));
  HEADERS[ext].copy(first, 0, 0, Math.min(HEADERS[ext].length, first.length));
  const start = Date.now();
  let sent = 0;
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const pump = () => {
    if (closed) return;
    if (sent >= total) {
      res.end();
      return;
    }
    const piece = (sent === 0 ? first : zeros).subarray(0, Math.min(size, total - sent));
    sent += piece.length;
    const due = start + (sent / bytesPerSecond) * 1000;
    const next = () => setTimeout(pump, Math.max(0, due - Date.now()));
    if (res.write(piece)) next();
    else res.once('drain', next);
  };
  pump();
}
