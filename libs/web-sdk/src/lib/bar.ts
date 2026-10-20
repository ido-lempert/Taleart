import type { DeliveryTaleGroup } from '@taleart/contract';

/** The frame type this renderer draws (AD-5). */
export const BAR_FRAME_TYPE = 'bar';

/**
 * Default bar look: circle, medium (64 px), titles shown, start-aligned,
 * 12 px gap. Bar settings arrive in a later story; themes after that.
 */
export const BAR_STYLES = `
:host { display: block; }
.bar {
  display: flex;
  gap: 12px;
  justify-content: flex-start;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  padding: 4px;
  margin: 0;
  list-style: none;
}
.bar::-webkit-scrollbar { display: none; }
.bar > li { flex: none; }
.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 76px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.item:focus-visible { outline: 2px solid #1a56db; outline-offset: 2px; border-radius: 8px; }
.ring {
  box-sizing: border-box;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  padding: 2px;
  background: linear-gradient(45deg, #f59e0b, #db2777, #7c3aed);
}
.item[data-seen] .ring { background: #6b7280; }
.cover {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid #fff;
  object-fit: cover;
  background: #e5e7eb;
}
.title {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
}
`;

// The group's cover: the first tale with media: its image, or that video's first frame
// (metadata only, never autoplayed); a neutral placeholder with no media.
function cover(group: DeliveryTaleGroup): HTMLElement {
  const media = group.tales.find((tale) => tale.media)?.media;
  let el: HTMLElement;
  if (media?.kind === 'image') {
    const img = document.createElement('img');
    img.src = media.url;
    img.alt = '';
    img.decoding = 'async';
    el = img;
  } else if (media?.kind === 'video') {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.autoplay = false;
    video.setAttribute('aria-hidden', 'true');
    // The fragment makes Safari and iOS paint the first frame with metadata-only preload.
    video.src = `${media.url}#t=0.001`;
    el = video;
  } else {
    el = document.createElement('span');
    el.setAttribute('data-placeholder', '');
  }
  el.className = 'cover';
  return el;
}

/**
 * Marks a bar item seen or unseen: the seen ring, and the name says so for
 * screen readers, since the ring's colour alone does not.
 */
export function setItemSeen(button: HTMLElement, name: string, seen: boolean): void {
  button.toggleAttribute('data-seen', seen);
  button.setAttribute('aria-label', seen ? `${name}, seen` : name);
}

/**
 * One bar item per tale group, in order, as buttons named by the group; the
 * groups in `seen` show the seen ring.
 */
export function renderBar(groups: readonly DeliveryTaleGroup[], seen: ReadonlySet<string> = new Set()): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'bar';
  for (const group of groups) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    button.dataset['taleGroupId'] = group.id;
    setItemSeen(button, group.name, seen.has(group.id));
    const ring = document.createElement('span');
    ring.className = 'ring';
    ring.appendChild(cover(group));
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = group.name;
    title.setAttribute('aria-hidden', 'true');
    button.append(ring, title);
    item.appendChild(button);
    list.appendChild(item);
  }
  return list;
}
