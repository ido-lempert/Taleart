import type { DeliveryTaleElement } from '@taleart/contract';
import type { RenderContext } from './media';
import { choicesOf, renderChoiceCard, text, type Choice, type ChoiceWords } from './poll';

const QUIZ_WORDS: ChoiceWords = {
  chose: (label) => `You answered ${label}.`,
  preview: 'Answers are not recorded in the preview.',
  failed: 'Your answer could not be sent. Try again.',
};

// Marks a button as the correct answer or as a wrong one: a glyph people see, words a screen reader
// reads in the button's name, and the colour (never alone).
function markButton(button: HTMLButtonElement | undefined, right: boolean): void {
  if (!button) return;
  button.classList.add(right ? 'ta-quiz-right' : 'ta-quiz-wrong');
  const glyph = text('span', 'ta-quiz-mark', right ? '✓' : '✗');
  glyph.setAttribute('aria-hidden', 'true');
  button.querySelector('.ta-poll-label')?.after(glyph, text('span', 'ta-sr', right ? ' correct answer' : ' wrong'));
}

/**
 * What the quiz says once answered, and its marks (epic interactive components R3): with a correct
 * answer, whether the visitor was right, with the correct answer marked and a wrong one marked
 * wrong; without one (a survey), nothing beyond the card's own words.
 */
export function quizMark(answers: readonly Choice[], correctId: string | null) {
  return (value: string, button: (id: string) => HTMLButtonElement | undefined): string | undefined => {
    const correct = answers.find((a) => a.id === correctId);
    if (!correct) return undefined;
    // The correct answer is marked even when the visitor's kept answer has since been removed.
    markButton(button(correct.id), true);
    const mine = answers.find((a) => a.id === value);
    if (!mine) return undefined;
    if (mine.id === correct.id) return `Right! You answered ${mine.label}.`;
    markButton(button(mine.id), false);
    return `Wrong: you answered ${mine.label}. The correct answer is ${correct.label}.`;
  };
}

/**
 * A quiz (epic interactive components R3, R10; AD-16): a choice card of its two to four answers.
 * Once answered it shows each answer's percentage with the visitor's answer pressed and, when the
 * quiz has a correct answer, marks it and a wrong answer (the correct answer comes with the
 * published document, C10, so it is marked at once, in the preview too); a quiz without one is a
 * survey and shows only the percentages. Null for props it cannot draw; a correct answer id that is
 * none of its answers is read as none.
 */
export function renderQuiz(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const props = element.props as { question?: unknown; correctAnswerId?: unknown };
  const answers = choicesOf(element.props, 'answers', 2, 4);
  const question = typeof props.question === 'string' ? props.question.trim() : '';
  if (!answers || !question) return null;
  const correctId = typeof props.correctAnswerId === 'string' ? props.correctAnswerId : null;
  const card = renderChoiceCard(element, context, { choices: answers, words: QUIZ_WORDS, mark: quizMark(answers, correctId) }, question);
  card.classList.add('ta-quiz');
  return card;
}
