import type { DeliveryTaleGroup } from '@taleart/contract';
import type { TaleViewer, TaleViewerOptions } from './viewer';

// The viewer's module, loaded when a visitor first opens a group (AD-16): the SDK's entry stays under
// its size budget, and the viewer, its styles and the tale documents' renderers load with it. A failed
// load is not kept: the next open tries again.
let loaded: Promise<typeof import('./viewer')> | null = null;
const loadViewer = (): Promise<typeof import('./viewer')> =>
  (loaded ??= import('./viewer').catch((err: unknown) => {
    loaded = null;
    throw err;
  }));

/**
 * A `TaleViewer` that is created on its first open, from the viewer's own chunk. It keeps the
 * viewer's surface the SDK uses (`open`, `close`, `groupId`): `open` answers at once, and the group
 * opened while the module loads is shown when it arrives (unless the viewer is closed first).
 */
export class LazyTaleViewer {
  private viewer: TaleViewer | null = null;
  private ready: Promise<TaleViewer> | null = null;
  // The group a visitor opened while the module loads; null once shown, or when closed meanwhile.
  private pending: string | null = null;

  constructor(
    private readonly root: ShadowRoot | HTMLElement,
    private readonly groups: readonly DeliveryTaleGroup[],
    private readonly options: TaleViewerOptions = {},
  ) {}

  /** The id of the group on screen (or about to be), or null when closed. */
  get groupId(): string | null {
    return this.viewer ? this.viewer.groupId : this.pending;
  }

  /** Opens the group `groupId` at its first tale; false for an unknown group or one without tales. */
  open(groupId: string): boolean {
    if (!this.groups.some((group) => group.id === groupId && group.tales.length > 0)) return false;
    if (this.viewer) return this.viewer.open(groupId);
    this.pending = groupId;
    this.load().then(
      (viewer) => {
        const next = this.pending;
        this.pending = null;
        // Nothing to show when the open was closed meanwhile, or the page took its root away (a re-render).
        if (next === null || !this.root.isConnected) return;
        viewer.open(next);
      },
      () => {
        this.pending = null;
      },
    );
    return true;
  }

  /** Closes the viewer, or stops the open that waits for its module. */
  close(): void {
    this.pending = null;
    this.viewer?.close();
  }

  private load(): Promise<TaleViewer> {
    this.ready ??= loadViewer().then(
      ({ TaleViewer }) => (this.viewer = new TaleViewer(this.root, this.groups, this.options)),
      (err: unknown) => {
        this.ready = null;
        throw err;
      },
    );
    return this.ready;
  }
}
