import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { axeViolations } from './axe';
import { emptyInstall, signIn } from './session';

/**
 * A quiz, end to end (epic interactive components story 4.3): a four-answer quiz with answer B
 * correct is made in Tale Studio by keyboard (answers added, the correct one picked) and updated to
 * the site; on the test page one visitor answers B (right), another answers C by keyboard (C marked
 * wrong, B right, percentages shown, the tale not stepped), a third answers D; a quiz without a
 * correct answer shows only the percentages; in the studio B's text is edited and its count stays,
 * D is removed and its count no longer shows; five answers and a correct id that is no answer are
 * refused on save. Signs in with a session written to the database and empties the install at the
 * end. E2E_SCREENSHOTS, when set, is a folder for screenshots.
 */

const API = '/api/v1';
const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const barItems = (page: Page) => page.locator('taleart-view button.item');
const answers = (page: Page) => page.locator('taleart-view dialog .ta-quiz button.ta-poll-opt');
const viewer = (page: Page) => page.locator('taleart-view dialog');
const marks = (page: Page) =>
  answers(page).evaluateAll((all) =>
    all.map((b) => (b.classList.contains('ta-quiz-right') ? 'right' : b.classList.contains('ta-quiz-wrong') ? 'wrong' : '-')),
  );

// The responses recorded so far, read from the e2e database.
async function responseRows(): Promise<{ value: string }[]> {
  const client = new pg.Client({ connectionString: e2eDatabase(process.env).url });
  await client.connect();
  try {
    return (await client.query<{ value: string }>('SELECT value FROM interactive_responses ORDER BY created_at')).rows;
  } finally {
    await client.end();
  }
}

test.describe.serial('a quiz (epic interactive components story 4.3)', () => {
  let context: BrowserContext;
  let page: Page;
  let taleId = '';
  let quizId = '';
  let testPageUrl = '';

  async function api<T>(method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
    const res = await page.request.fetch(`${API}${path}`, { method, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  }

  // The test page afresh, in a browser of its own (a visitor of its own), with group `nth` open.
  async function visit(browser: import('@playwright/test').Browser, nth = 0): Promise<{ site: Page; close: () => Promise<void> }> {
    const own = await browser.newContext();
    const site = await own.newPage();
    await site.goto(testPageUrl);
    await expect(barItems(site)).toHaveCount(2, { timeout: 20_000 });
    await barItems(site).nth(nth).click();
    await expect(answers(site)).toHaveCount(nth === 0 ? 4 : 2);
    return { site, close: () => own.close() };
  }

  const counts = () =>
    page.locator('#studio-responses li').evaluateAll((items) =>
      items.map((li) => [...li.children].map((part) => (part.textContent ?? '').trim()).join(' ')),
    );

  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext();
    await context.addCookies([{ name: 'taleart_session', value: await signIn('A quiz'), url: baseURL ?? '' }]);
    page = await context.newPage();
    await page.goto('/sign-in');
    const project = await api<{ id: string }>('post', '/projects', { name: 'Quizzes' });
    const zone = await api<{ id: string; slug: string }>('post', '/zones', { name: 'Home top', projectId: project.id });
    await api('post', `/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
    const group = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Space' });
    taleId = (await api<{ id: string }>('post', `/tale-groups/${group.id}/tales`, { title: 'Planets' })).id;
    await api('put', `/tale-groups/${group.id}/status`, { status: 'live' });
    // A second group whose tale holds a quiz without a correct answer: a survey.
    const survey = await api<{ id: string }>('post', `/zones/${zone.id}/tale-groups`, { name: 'Survey' });
    const surveyTale = (await api<{ id: string }>('post', `/tale-groups/${survey.id}/tales`, { title: 'Pick one' })).id;
    await api('put', `/tales/${surveyTale}/document`, {
      document: {
        version: 1,
        canvas: { background: { type: 'color', color: '#0F766E' } },
        elements: [
          {
            id: crypto.randomUUID(),
            type: 'quiz',
            box: { x: 0.1, y: 0.3, w: 0.8, h: 0.3, rotation: 0 },
            hidden: false,
            locked: false,
            a11y: {},
            props: {
              question: 'Which do you like best?',
              theme: 'dark',
              answers: [
                { id: 'sea', label: 'The sea' },
                { id: 'hills', label: 'The hills' },
              ],
            },
          },
        ],
      },
      revision: 0,
    });
    await api('post', `/tales/${surveyTale}/document/publish`, { revision: 1, publishedRevision: 0 });
    await api('put', `/tale-groups/${survey.id}/status`, { status: 'live' });
    const { key } = await api<{ key: string }>('post', `/zones/${zone.id}/key`, {});
    const install = await api<{ testPageUrl: string }>('get', '/install');
    testPageUrl = `${install.testPageUrl}#zoneKey=${encodeURIComponent(key)}`;
  });

  test.afterAll(async () => {
    await context.close();
    await emptyInstall();
  });

  test('makes a four-answer quiz with answer B correct by keyboard, and updates the tale', async () => {
    await page.goto(`/tales/${taleId}/studio`);
    await page.locator('#studio-add-quiz').click();
    const question = page.locator('input[id^="field-quiz-question-"]');
    // Focus is on the new element on the canvas (story 11.4); its inspector shows its fields.
    await expect(page.locator('[id^="studio-el-"]:focus')).toHaveCount(1);
    quizId = (await question.getAttribute('id'))?.replace('field-quiz-question-', '') ?? '';
    await question.fill('Which planet is hottest?');
    await question.press('Tab');
    const g = `#field-quiz-answers-${quizId}`;
    // Two more answers, each by Enter on Add answer: focus moves to the new answer's text.
    for (const n of [2, 3]) {
      await page.locator(`${g}-add`).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(`${g}-${n}`)).toBeFocused();
    }
    await expect(page.locator(`${g}-add`)).toHaveAttribute('aria-disabled', 'true');
    for (const [i, label] of ['Mercury', 'Venus', 'Earth', 'Mars'].entries()) {
      await page.locator(`${g}-${i}`).fill(label);
      await page.locator(`${g}-${i}`).press('Tab');
    }
    // Reorder by keyboard: Mars up and back down again keeps the order (and the ids).
    await page.locator(`${g}-3-up`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${g}-2`)).toHaveValue('Mars');
    await expect(page.locator(`${g}-2-up`)).toBeFocused();
    await page.locator(`${g}-2-down`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${g}-3`)).toHaveValue('Mars');
    await page.locator(`${g}-correct`).focus();
    await page.locator(`${g}-correct`).selectOption({ label: 'Answer 2: Venus' });
    await expect(page.locator('#studio-responses-total')).toHaveText('0 answers');
    // The quiz's inspector, its list field and correct pick included, passes the WCAG 2.2 AA scan.
    expect(await axeViolations(page), 'with the quiz selected').toEqual([]);
    await page.locator('#studio-update').click();
    await expect
      .poll(async () => {
        const read = await api<{ published: { document: { elements: { type: string; props: Record<string, unknown> }[] } | null } }>(
          'get',
          `/tales/${taleId}/document`,
        );
        const quiz = read.published.document?.elements[0]?.props as { answers?: { id: string; label: string }[]; correctAnswerId?: string } | undefined;
        return quiz ? [quiz.answers?.map((a) => a.label), quiz.answers?.[1]?.id === quiz.correctAnswerId] : null;
      })
      .toEqual([['Mercury', 'Venus', 'Earth', 'Mars'], true]);
    await shot(page, 'quiz-01-studio');
  });

  test('refuses five answers and a correct id that is not an answer on save', async () => {
    const { document, revision } = await api<{ document: { elements: { props: Record<string, unknown> }[] }; revision: number }>(
      'get',
      `/tales/${taleId}/document`,
    );
    const save = async (props: Record<string, unknown>) => {
      const bad = { ...document, elements: document.elements.map((e) => ({ ...e, props: { ...e.props, ...props } })) };
      return page.request.fetch(`${API}/tales/${taleId}/document`, { method: 'put', data: { document: bad, revision } });
    };
    const answersNow = document.elements[0].props['answers'] as unknown[];
    const five = await save({ answers: [...answersNow, { id: 'e', label: 'Jupiter' }] });
    expect(five.status()).toBe(400);
    expect((await five.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer: '/elements/0/props/answers' });
    const stranger = await save({ correctAnswerId: 'not-an-answer' });
    expect(stranger.status()).toBe(400);
    expect((await stranger.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer: '/elements/0/props/correctAnswerId' });
  });

  test('a visitor answers B: it is marked right', async ({ browser }) => {
    const { site, close } = await visit(browser);
    await shot(site, 'quiz-02-before');
    await answers(site).nth(1).click();
    await expect(answers(site).nth(1)).toHaveAttribute('aria-pressed', 'true');
    expect(await marks(site)).toEqual(['-', 'right', '-', '-']);
    await expect(site.locator('taleart-view dialog .ta-quiz [aria-live=polite]')).toHaveText(
      'Right! You answered Venus. Mercury 0%, Venus 100%, Earth 0%, Mars 0%',
    );
    await shot(site, 'quiz-03-right');
    await close();
  });

  test('another answers C by keyboard: C is marked wrong, B right, the percentages show and the tale stays', async ({ browser }) => {
    const { site, close } = await visit(browser);
    const before = await viewer(site).getAttribute('aria-label');
    await answers(site).nth(2).focus();
    await expect(viewer(site)).toHaveAttribute('data-paused', '');
    await site.keyboard.press('Enter');
    await expect(answers(site).nth(2)).toHaveAttribute('aria-pressed', 'true');
    expect(await marks(site)).toEqual(['-', 'right', 'wrong', '-']);
    await expect(answers(site)).toHaveText(['Mercury0%', 'Venus✓ correct answer50%', 'Earth✗ wrong50%', 'Mars0%']);
    await expect(site.locator('taleart-view dialog .ta-quiz [aria-live=polite]')).toHaveText(
      'Wrong: you answered Earth. The correct answer is Venus. Mercury 0%, Venus 50%, Earth 50%, Mars 0%',
    );
    await expect(viewer(site)).toHaveAttribute('aria-label', before ?? '');
    await expect(viewer(site).locator('.segment.done')).toHaveCount(0);
    await shot(site, 'quiz-04-wrong');
    await close();
    const third = await visit(browser);
    await answers(third.site).nth(3).click();
    await expect(answers(third.site).nth(3)).toHaveAttribute('aria-pressed', 'true');
    await third.close();
    await expect.poll(async () => (await responseRows()).map((r) => r.value).length).toBe(3);
  });

  test('a quiz without a correct answer shows only the percentages', async ({ browser }) => {
    const { site, close } = await visit(browser, 1);
    await answers(site).nth(0).click();
    await expect(answers(site).nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(answers(site)).toHaveText(['The sea100%', 'The hills0%']);
    expect(await marks(site)).toEqual(['-', '-']);
    await expect(site.locator('taleart-view dialog .ta-quiz [aria-live=polite]')).toHaveText(
      'You answered The sea. The sea 100%, The hills 0%',
    );
    await shot(site, 'quiz-05-survey');
    await close();
  });

  test("the inspector counts per answer; B's count stays when its text changes, and D's goes with D", async () => {
    await page.locator('#studio-responses-refresh').click();
    await expect(page.locator('#studio-responses-total')).toHaveText('3 answers');
    expect(await counts()).toEqual(['Mercury 0', 'Venus (correct) 1', 'Earth 1', 'Mars 1']);
    await expect(page.locator('#studio-responses-note')).toContainText('already has answers');
    await shot(page, 'quiz-06-inspector');
    const g = `#field-quiz-answers-${quizId}`;
    await page.locator(`${g}-1`).fill('Venus, second planet');
    await page.locator(`${g}-1`).press('Tab');
    await expect.poll(counts).toEqual(['Mercury 0', 'Venus, second planet (correct) 1', 'Earth 1', 'Mars 1']);
    await page.locator(`${g}-3-remove`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`${g}-3`)).toHaveCount(0);
    await expect.poll(counts).toEqual(['Mercury 0', 'Venus, second planet (correct) 1', 'Earth 1']);
    await expect(page.locator('#studio-responses-total')).toHaveText('2 answers');
    await shot(page, 'quiz-07-inspector-edited');
  });
});
