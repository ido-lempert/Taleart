// Undoes Tale Studio story 7.11 (epic R16) in the data, so the release before it can run again: that
// release refuses a tale document holding a `taleMedia` element, and would then show such a tale's
// media without its studio layers. For every tale whose draft or published document holds one:
//   - for a tale in step (`document_media_key = media_key`), the tale's media columns take the key
//     the published document (else the draft) shows, so the previous release shows what visitors saw;
//     a tale out of step keeps its media columns, and an unchanged key keeps its content type;
//   - the `taleMedia` elements leave both documents; a document the migration created
//     (`document_created_by_migration`) that holds nothing else becomes null again, as it was; others
//     keep their other layers and duration;
//   - each changed document's revision rises, and its `tale_media` rows keep only the keys it still uses;
//   - `document_media_key` and the skip marks are cleared.
// Order: set TALE_MEDIA_MIGRATION=off on every instance of the new release and restart them (so
// nothing writes `taleMedia` again), run this with --apply, then deploy the previous release.
//
//   node apps/api/scripts/tale-media-rollback.mjs [--apply] [--yes-production]
// DATABASE_URL names the database. Without --apply it only reads and reports what it would change. A database
// whose name does not end in _test also needs --yes-production. Plain Node and `pg`; nothing installed.
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const url = process.env.DATABASE_URL || 'postgres://taleart:taleart@localhost:5432/taleart';
const database = parseConnectionString(url).database ?? '';
if (apply && !database.endsWith('_test') && !args.has('--yes-production')) {
  console.error(`Refusing to change ${database}: add --yes-production to roll back a database not ending in _test`);
  process.exit(2);
}

const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};
const isOwn = (e) => (e?.type === 'image' || e?.type === 'video') && e?.props?.taleMedia === true;
const holdsOwn = (doc) => Array.isArray(doc?.elements) && doc.elements.some(isOwn);
// The document without its `taleMedia` elements; null when the migration made it (`created`) and it
// holds nothing else, as before the migration. A person's document keeps its other layers.
function without(doc, created) {
  if (!holdsOwn(doc)) return doc;
  const elements = doc.elements.filter((e) => !isOwn(e));
  const empty = elements.length === 0 && doc.canvas?.background?.type !== 'media';
  return created && empty ? null : { ...doc, elements };
}
// The media keys a document still uses: media elements, image stickers and a media background.
function keysOf(doc) {
  const keys = new Set();
  if (doc?.canvas?.background?.type === 'media') keys.add(doc.canvas.background.mediaKey);
  for (const e of Array.isArray(doc?.elements) ? doc.elements : []) {
    if (typeof e?.props?.mediaKey === 'string') keys.add(e.props.mediaKey);
  }
  return keys;
}

const pool = new pg.Pool({ connectionString: url, max: 2 });
// A session the database ends (a restart, a terminated backend) makes pg emit `error`: on the pool
// for an idle client, on the client while it is checked out. Without listeners Node would exit
// mid-batch; with them the batch fails, rolls back and the script stops with the error.
pool.on('error', (err) => console.error(`Idle database connection failed: ${err.message}`));
const FLAGGED = JSON.stringify({ elements: [{ props: { taleMedia: true } }] });
const counts = { tales: 0, nulled: 0, mediaChanged: 0 };
try {
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const client = await pool.connect();
    let lost = null;
    const onError = (err) => {
      lost ??= err;
    };
    client.on('error', onError);
    let last = null;
    try {
      // A dry run only reads: no transaction, no row locks.
      if (apply) await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, media_key AS key, document_media_key AS "inStep", document, draft_document AS draft,
           document_created_by_migration AS created FROM tales
         WHERE id > $1 AND (document @> $2::jsonb OR draft_document @> $2::jsonb)
         ORDER BY id LIMIT 200${apply ? ' FOR UPDATE' : ''}`,
        [after, FLAGGED],
      );
      for (const row of rows) {
        last = row.id;
        counts.tales++;
        const shown = [row.document, row.draft]
          .map((d) => (Array.isArray(d?.elements) ? d.elements.find(isOwn) : null))
          .find(Boolean);
        // Only a tale in step shows its media in its documents; one out of step (an older instance
        // changed its media) keeps the media key it holds, which visitors were shown composed.
        const key = row.inStep !== null && row.inStep === row.key ? shown?.props?.mediaKey : undefined;
        const type =
          typeof key === 'string' && key !== row.key ? TYPES[key.slice(key.lastIndexOf('.') + 1)] : undefined;
        if (type) counts.mediaChanged++;
        const document = without(row.document, row.created);
        const draft = without(row.draft, row.created);
        counts.nulled += (row.document && !document ? 1 : 0) + (row.draft && !draft ? 1 : 0);
        if (!apply) continue;
        await client.query(
          `UPDATE tales SET document = $2::jsonb, draft_document = $3::jsonb,
             document_revision = document_revision + $4, draft_revision = draft_revision + $5,
             media_key = COALESCE($6, media_key), media_content_type = COALESCE($7, media_content_type),
             document_media_key = NULL, document_media_skip_key = NULL, document_media_skip_reason = NULL,
             document_media_skip_at = NULL, document_created_by_migration = false
           WHERE id = $1`,
          [
            row.id,
            document === null ? null : JSON.stringify(document),
            draft === null ? null : JSON.stringify(draft),
            document === row.document ? 0 : 1,
            draft === row.draft ? 0 : 1,
            type ? key : null,
            type ?? null,
          ],
        );
        for (const [which, doc] of [
          ['published', document],
          ['draft', draft],
        ]) {
          await client.query(
            'DELETE FROM tale_media WHERE tale_id = $1 AND document = $2 AND NOT (storage_key = ANY($3::text[]))',
            [row.id, which, [...keysOf(doc)]],
          );
        }
      }
      if (apply) await client.query('COMMIT');
    } catch (err) {
      if (apply && !lost) await client.query('ROLLBACK').catch(() => undefined);
      throw lost ?? err;
    } finally {
      client.off('error', onError);
      // A client whose session ended is dropped from the pool.
      client.release(lost ?? undefined);
    }
    if (last === null) break;
    after = last;
  }
  // Every other tale forgets it was in step, in batches, so no long lock is held.
  for (let cleared = 1; apply && cleared > 0; ) {
    const { rowCount } = await pool.query(
      `UPDATE tales SET document_media_key = NULL, document_created_by_migration = false
       WHERE id IN (SELECT id FROM tales WHERE document_media_key IS NOT NULL OR document_created_by_migration
                    LIMIT 1000)`,
    );
    cleared = rowCount ?? 0;
  }
  console.log(
    `${apply ? 'Rolled back' : 'Would roll back (dry run; add --apply)'}: ${counts.tales} tale(s) with their media in ` +
      `their documents; ${counts.nulled} document(s) the migration created set back to null; ` +
      `${counts.mediaChanged} tale media key(s) taken from the documents, in ${database}`,
  );
} finally {
  await pool.end();
}
