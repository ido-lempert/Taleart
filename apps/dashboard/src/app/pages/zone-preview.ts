import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import type { DeliveryZone, Zone, ZoneTaleGroup } from '@taleart/contract/core';
import { emptyTaleDocument, type TaleDocument } from '@taleart/contract/tale-document';
import { Icon } from '../icon';
import { ProjectFontsService } from '../project-fonts.service';
import { TaleDocumentService } from '../tale-document.service';
import { ThemeService } from '../theme.service';
import { groupPreviewZone, previewPublishedTaleIds } from './tale-preview-group';
import { TalePreviewPane } from './tale-preview';

/**
 * A zone's preview, or one group's in it, as a visitor's page shows it (the Tale Studio preview's full view, on the
 * dashboard's Tale groups and Zones pages): the Web SDK's own rendering of the zone's display and its visible groups,
 * with the viewer open on `groupId` when one is given. The tales are drawn from their published documents; no
 * targeting applies. It is modal: the shell beside it becomes inert, and Escape or Close closes it and puts focus
 * back on `returnFocus`. The page shows at most one at a time.
 */
@Component({
  selector: 'app-zone-preview',
  imports: [TalePreviewPane, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'close($event)' },
  // Its rules all start at app-zone-preview, so they do not reach the page.
  encapsulation: ViewEncapsulation.None,
  styles: `
    app-zone-preview {
      position: fixed;
      inset: 0;
      z-index: 50;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgb(15 17 23 / 72%);
    }
    /* Everything sits on one solid card, so nothing reads against the dimmed page behind it. */
    app-zone-preview .zone-preview {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: min(100%, 560px);
      max-height: 100%;
      overflow: auto;
      padding: var(--space-4, 16px);
      background: var(--surface, #fff);
      border-radius: var(--radius-card, 12px);
      box-shadow: var(--shadow-raised, 0 12px 40px rgb(0 0 0 / 35%));
    }
    app-zone-preview .zone-preview__close {
      align-self: flex-end;
    }
  `,
  template: `
    <div role="dialog" aria-modal="true" [attr.aria-label]="label()" class="zone-preview">
      <button
        type="button"
        class="btn btn--secondary btn--sm zone-preview__close"
        id="zone-preview-close"
        (click)="close()"
      >
        <app-icon name="close" /> Close preview
      </button>
      @if (delivered(); as zone) {
        <app-tale-preview
          id="zone-preview-pane"
          [document]="blank"
          taleId=""
          [projectId]="projectId()"
          [zone]="zone"
          [groupId]="groupId()"
        />
      } @else if (failed()) {
        <p class="form-error" role="alert">The preview could not be read. Close it and try again.</p>
      } @else {
        <p class="muted" role="status">Reading the preview…</p>
      }
    </div>
  `,
})
export class ZonePreview implements OnInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly documents = inject(TaleDocumentService);
  private readonly themes = inject(ThemeService);
  private readonly fonts = inject(ProjectFontsService);

  /** The zone shown (its display is what visitors see). */
  readonly zone = input.required<Zone>();
  /** The zone's tale groups, as the studio's lists hold them (each with its tales). */
  readonly groups = input.required<readonly ZoneTaleGroup[]>();
  /** The group the viewer opens on; '' for the zone itself. */
  readonly groupId = input('');
  /** The dialog's accessible name, such as "Preview of Summer". */
  readonly label = input('Preview');
  /** Where focus goes when the preview closes: the button that opened it. */
  readonly returnFocus = input<HTMLElement | null>(null);

  readonly closed = output<void>();

  /** An empty document: the group preview draws each tale from its published one, so this is never shown. */
  protected readonly blank: TaleDocument = emptyTaleDocument();
  protected readonly projectId = signal('');
  /** The zone as the Web SDK renders it; null until read. */
  protected readonly delivered = signal<DeliveryZone | null>(null);
  protected readonly failed = signal(false);

  /** What the page had focused before it opened, restored on close, and what the shell made inert. */
  private opener: HTMLElement | null = null;
  private inerted: HTMLElement[] = [];
  private rootOverflow: string | null = null;

  constructor() {
    afterNextRender(() => {
      const host = this.host.nativeElement;
      const document = host.ownerDocument;
      const shell = document.querySelector<HTMLElement>('.shell');
      if (shell) {
        // Beside the shell, as the group view is: the shell and the skip link become inert under it.
        const active = document.activeElement as HTMLElement | null;
        shell.after(host);
        if (active && host.contains(active)) active.focus();
        this.inerted = [shell, document.querySelector<HTMLElement>('.skip-link')].filter(
          (el): el is HTMLElement => !!el && !el.hasAttribute('inert'),
        );
        for (const el of this.inerted) el.setAttribute('inert', '');
        this.rootOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
      }
      host.querySelector<HTMLElement>('#zone-preview-close')?.focus();
    });
    inject(DestroyRef).onDestroy(() => this.restore());
  }

  ngOnInit(): void {
    this.opener = this.returnFocus();
    void this.load();
  }

  protected close(event?: Event): void {
    if (event?.defaultPrevented) return;
    event?.preventDefault();
    this.closed.emit();
  }

  /** Reads the theme, the fonts and the published documents the preview draws from, then delivers the zone. */
  private async load(): Promise<void> {
    const zone = this.zone();
    const groups = this.groups();
    const groupId = this.groupId();
    this.projectId.set(zone.projectId);
    const ids = previewPublishedTaleIds(groups, groupId, '');
    const [theme, fonts, reads] = await Promise.all([
      this.themes.load(zone.projectId),
      this.fonts.list(zone.projectId),
      Promise.all(ids.map(async (id) => [id, await this.documents.load(id)] as const)),
    ]);
    const published = new Map<string, TaleDocument | null>();
    for (const [id, result] of reads) if (result.value) published.set(id, result.value.published.document);
    const delivered = groupPreviewZone({
      projectId: zone.projectId,
      zone,
      groups,
      groupId,
      taleId: '',
      published,
      theme: theme.value?.resolved ?? null,
      fonts: fonts.value ?? [],
    });
    if (delivered) this.delivered.set(delivered);
    else this.failed.set(true);
  }

  /** Lifts what the open preview did to the page, then puts focus back on the button that opened it. */
  private restore(): void {
    const host = this.host.nativeElement;
    const document = host.ownerDocument;
    host.remove();
    for (const el of this.inerted) el.removeAttribute('inert');
    if (this.rootOverflow !== null) document.documentElement.style.overflow = this.rootOverflow;
    const opener = this.opener;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (opener?.isConnected) opener.focus();
      else document.getElementById('main')?.focus();
    });
  }
}
