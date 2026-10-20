import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_TALES_PER_GROUP, MEDIA_CONTENT_TYPES, type Invitation, type IssuedZoneKey } from '@taleart/contract';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { Drawer } from './drawer';

/**
 * The form for whatever the store's drawer request asks for: a create form, a
 * tale's media upload, a tale group's tags, an invitation link, or issuing,
 * rotating or revoking a zone key. The API's message shows inside it.
 */
@Component({
  selector: 'app-create-drawer',
  imports: [FormsModule, Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-drawer.html',
})
export class CreateDrawer implements OnInit {
  protected readonly store = inject(DashboardStore);
  readonly request = input.required<DrawerRequest>();

  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly maxTales = MAX_TALES_PER_GROUP;
  protected text = '';
  protected projectId = '';
  protected frameType = '';
  /** The image or video picked in the file input, if any. */
  protected file: File | null = null;
  protected readonly acceptedTypes = MEDIA_CONTENT_TYPES.join(',');
  /** The invitation an invite drawer created; its link is shown only now. */
  protected readonly invitation = signal<Invitation | null>(null);
  /** The zone key an issue or rotate drawer created; shown only now. */
  protected readonly issuedKey = signal<IssuedZoneKey | null>(null);
  /** '' or the outcome of the last "Copy link" or "Copy key", announced to screen readers. */
  protected readonly copyStatus = signal('');
  /** The tags checked in a tags drawer. */
  protected readonly selectedTagIds = signal<string[]>([]);
  /** The name typed in a tags drawer's "New tag" field. */
  protected newTag = '';

  /** The tale group a tags drawer is for. */
  protected readonly tagGroup = computed(() => {
    const request = this.request();
    return request.kind === 'tags' ? this.store.taleGroup(request.taleGroupId) : undefined;
  });

  /** The tags a tags drawer offers: every tag of the group's project. */
  protected readonly projectTags = computed(() => {
    const group = this.tagGroup();
    return group ? this.store.tagsOf(group.projectId) : [];
  });

  /** The tale a media drawer is for. */
  protected readonly tale = computed(() => {
    const request = this.request();
    return request.kind === 'taleMedia' ? this.store.tale(request.taleId) : undefined;
  });

  protected readonly fileLabel = computed(() => {
    if (this.request().kind === 'tale') return 'Image or video (optional)';
    return this.tale()?.media ? 'Replace image or video' : 'Image or video';
  });

  protected readonly submitLabel = computed(() => {
    switch (this.request().kind) {
      case 'frame':
      case 'tale':
        return 'Add';
      case 'taleMedia':
        return 'Upload';
      case 'invite':
        return 'Create link';
      case 'tags':
        return 'Save';
      case 'zoneKey':
        return this.zoneKeyRequest()?.action === 'rotate'
          ? 'Rotate key'
          : this.zoneKeyRequest()?.action === 'revoke'
            ? 'Revoke key'
            : 'Issue key';
      default:
        return 'Create';
    }
  });

  /** The request of a zone key drawer, else undefined. */
  protected readonly zoneKeyRequest = computed(() => {
    const request = this.request();
    return request.kind === 'zoneKey' ? request : undefined;
  });

  /** The zone a zone key drawer is for. */
  protected readonly keyZone = computed(() => {
    const request = this.zoneKeyRequest();
    return request ? this.store.zone(request.zoneId) : undefined;
  });

  /** The zone's active key, which a rotate or revoke drawer names. */
  protected readonly activeKey = computed(() => {
    const request = this.zoneKeyRequest();
    return request ? this.store.zoneKey(request.zoneId) : null;
  });

  /** True when the drawer's work is done and it shows only the result (a link or a key) and "Done". */
  protected readonly showsResult = computed(() => this.invitation() !== null || this.issuedKey() !== null);

  protected readonly heading = computed(() => {
    switch (this.request().kind) {
      case 'project':
        return 'New project';
      case 'zone':
        return 'New zone';
      case 'frame':
        return 'Add frame';
      case 'taleGroup':
        return 'New tale group';
      case 'tale':
        return 'Add tale';
      case 'taleMedia':
        return 'Tale';
      case 'invite':
        return 'Invite to project';
      case 'tags':
        return 'Tags';
      case 'zoneKey':
        if (this.issuedKey()) return 'Zone key';
        return this.zoneKeyRequest()?.action === 'rotate'
          ? 'Rotate zone key'
          : this.zoneKeyRequest()?.action === 'revoke'
            ? 'Revoke zone key'
            : 'Issue zone key';
    }
  });

  /** The zone or tale group the new item goes into, for the drawer's context line. */
  protected readonly context = computed(() => {
    const request = this.request();
    if (request.kind === 'frame' || request.kind === 'taleGroup') {
      const zone = this.store.zone(request.zoneId);
      return zone ? `In zone ${zone.name}` : '';
    }
    if (request.kind === 'tale') {
      const group = this.store.taleGroup(request.taleGroupId);
      return group ? `In tale group ${group.name}` : '';
    }
    if (request.kind === 'tags') {
      const group = this.tagGroup();
      return group ? `For tale group ${group.name}` : '';
    }
    if (request.kind === 'invite') {
      return `To project ${this.store.projectName(request.projectId)}`;
    }
    if (request.kind === 'zoneKey') {
      const zone = this.keyZone();
      return zone ? `For zone ${zone.name}` : '';
    }
    if (request.kind === 'taleMedia') {
      const tale = this.tale();
      const group = tale && this.store.taleGroup(tale.taleGroupId);
      return group ? `In tale group ${group.name}` : '';
    }
    return '';
  });

  ngOnInit(): void {
    this.projectId = this.store.selectedProjectId();
    this.selectedTagIds.set(this.tagGroup()?.tags.map((t) => t.id) ?? []);
  }

  protected isTagSelected(tagId: string): boolean {
    return this.selectedTagIds().includes(tagId);
  }

  protected toggleTag(tagId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedTagIds.update((ids) => {
      const others = ids.filter((id) => id !== tagId);
      return checked ? [...others, tagId] : others;
    });
  }

  /** Creates the typed tag in the group's project and checks it. Enter in the field does this, not Save. */
  protected async addTag(event?: Event): Promise<void> {
    event?.preventDefault();
    const group = this.tagGroup();
    if (!group || this.saving()) return;
    this.saving.set(true);
    const { tag, message } = await this.store.createTag(group.projectId, this.newTag);
    this.saving.set(false);
    this.error.set(message);
    if (tag) {
      this.newTag = '';
      this.selectedTagIds.update((ids) => [...ids, tag.id]);
    }
  }

  protected pickFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.error.set('');
  }

  /** The invitation's expiry as a date, such as "27 Oct 2026". */
  protected expiryDate(invitation: Invitation): string {
    return new Date(invitation.expiresAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  /** True where the Web Share API exists (most phones, Safari, Chrome on Windows and ChromeOS). */
  protected readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** Opens the system share sheet with the invitation link. */
  protected async shareLink(invitation: Invitation): Promise<void> {
    const project = this.store.projectName(invitation.projectId);
    try {
      await navigator.share({
        title: `Join ${project} on TaleArt`,
        text: `You're invited to ${project} on TaleArt. The link works once, until ${this.expiryDate(invitation)}.`,
        url: invitation.url,
      });
      this.copyStatus.set('Link shared');
    } catch (err) {
      // Closing the share sheet is not an error.
      if ((err as DOMException)?.name === 'AbortError') return;
      this.copyStatus.set('Could not share. Copy the link instead.');
    }
  }

  protected async copyLink(invitation: Invitation): Promise<void> {
    try {
      await navigator.clipboard.writeText(invitation.url);
      this.copyStatus.set('Link copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the link and copy it.');
    }
  }

  protected async copyKey(key: IssuedZoneKey): Promise<void> {
    try {
      await navigator.clipboard.writeText(key.key);
      this.copyStatus.set('Key copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the key and copy it.');
    }
  }

  protected close(): void {
    this.store.closeDrawer();
  }

  protected async submit(): Promise<void> {
    const request = this.request();
    // Once the link or key is shown, Enter must not create another one.
    if (this.saving() || this.showsResult()) return;
    this.saving.set(true);
    let message: string;
    switch (request.kind) {
      case 'project':
        message = await this.store.createProject(this.text);
        break;
      case 'zone':
        message = await this.store.createZone(this.text, this.projectId);
        if (!message) this.store.selectProject(this.projectId);
        break;
      case 'frame':
        message = await this.store.createFrame(request.zoneId, this.frameType);
        break;
      case 'taleGroup':
        message = await this.store.createTaleGroup(request.zoneId, this.text);
        break;
      case 'tale':
        message = await this.store.createTale(request.taleGroupId, this.text, this.file);
        // The tale was saved but its media was not: the drawer now shows that
        // tale with an empty file input, so forget the refused file.
        if (message && this.store.drawer()?.kind === 'taleMedia') this.file = null;
        break;
      case 'invite': {
        const created = await this.store.createInvitation(request.projectId);
        this.invitation.set(created.invitation);
        this.saving.set(false);
        this.error.set(created.message);
        // The drawer stays open to show the link.
        return;
      }
      case 'tags':
        message = await this.store.setTaleGroupTags(request.taleGroupId, this.selectedTagIds());
        break;
      case 'zoneKey': {
        if (request.action === 'revoke') {
          message = await this.store.revokeZoneKey(request.zoneId);
          break;
        }
        // Issue and rotate are one call: issuing while a key is active rotates it.
        const issued = await this.store.issueZoneKey(request.zoneId);
        this.issuedKey.set(issued.key);
        this.saving.set(false);
        this.error.set(issued.message);
        // The drawer stays open to show the key once.
        return;
      }
      case 'taleMedia':
        message = this.file
          ? await this.store.uploadTaleMedia(request.taleId, this.file)
          : 'Choose an image or video to upload.';
        break;
    }
    this.saving.set(false);
    this.error.set(message);
    if (!message) this.close();
  }
}
