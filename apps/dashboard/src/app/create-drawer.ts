import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  linkedSignal,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  MAX_TALES_PER_GROUP,
  MAX_STAGE_KEY_LENGTH,
  MEDIA_CONTENT_TYPES,
  PLAYBOOKS,
  findPlaybook,
  stageKeyFromName,
  type Invitation,
  type IssuedZoneKey,
  type SetScheduleRequest,
  type SettableStatus,
  type Tale,
} from '@taleart/contract';
import { CoverEditor } from './cover-editor';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { Drawer } from './drawer';
import { describeWindow, localTimeZone, parseLocalInput, toLocalInput } from './schedule';
import { describeSettings, initialSettings, SettingsForm, type Settings } from './settings-form';
import { STATUS_LABELS, StatusBadge, statusActions } from './status';

/**
 * The form for whatever the store's drawer request asks for: a create form, a
 * tale's media upload, a tale group's tags, adding a tale group to a zone,
 * removing it from one or copying it to one, an invitation link, or issuing, rotating or revoking a
 * zone key. The API's message shows inside it.
 */
@Component({
  selector: 'app-create-drawer',
  imports: [FormsModule, RouterLink, Drawer, StatusBadge, SettingsForm, CoverEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-drawer.html',
})
export class CreateDrawer implements OnInit {
  protected readonly store = inject(DashboardStore);
  private readonly document = inject(DOCUMENT);
  /** Replaces the opener as the return-focus target, when the opener goes away with the drawer's work. */
  private returnTo: HTMLElement | null = null;
  /** Read by the drawer when it is removed: the replacement target, else the element that opened it. */
  protected readonly returnFocus = (): HTMLElement | null => this.returnTo ?? this.store.drawerOpener;
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
  /** The zone picked in an "Add to zone…" drawer. */
  protected readonly placeZoneId = signal('');

  /** The playbooks an apply drawer offers (R8). */
  protected readonly playbooks = PLAYBOOKS;
  /** The playbook picked in an apply drawer. */
  protected readonly playbookKey = signal(PLAYBOOKS[0]?.key ?? '');

  /** The zone of an apply playbook drawer. */
  protected readonly playbookZone = computed(() => {
    const request = this.request();
    return request.kind === 'applyPlaybook' ? this.store.zone(request.zoneId) : undefined;
  });

  /** The picked playbook. */
  protected readonly pickedPlaybook = computed(() => findPlaybook(this.playbookKey()));

  /** What the picked playbook creates: each frame with its settings as labels and values, and its stage. */
  protected readonly playbookPreview = computed(() =>
    (this.pickedPlaybook()?.frames ?? []).map((frame) => ({
      type: this.store.frameTypeLabel(frame.type),
      settings: describeSettings(this.store.frameType(frame.type)?.schema, frame.settings as unknown as Settings),
      stage: frame.stage,
    })),
  );

  /**
   * Why the picked playbook cannot be applied to the zone, or '': the zone has
   * another playbook, or already uses one of its stage keys. The API refuses both.
   */
  protected readonly playbookConflict = computed(() => {
    const zone = this.playbookZone();
    const playbook = this.pickedPlaybook();
    if (!zone || !playbook) return '';
    if (zone.playbookKey && zone.playbookKey !== playbook.key) {
      const applied = findPlaybook(zone.playbookKey)?.label ?? zone.playbookKey;
      return `This zone already has the playbook ${applied}. A zone has one playbook.`;
    }
    if (zone.playbookKey === playbook.key) return '';
    const used = new Set(this.store.stagesOf(zone.id).map((stage) => stage.key));
    const taken = playbook.frames.find((frame) => used.has(frame.stage.key));
    return taken
      ? `This zone already has a stage with the key ${taken.stage.key}. Delete that stage first, then apply ${playbook.label}.`
      : '';
  });

  /** The playbook fieldset's description: the conflict warning while shown, and the API's or the drawer's message. */
  protected readonly playbookDescribedBy = computed(() => {
    const ids = [this.playbookConflict() && !this.error() ? 'playbook-conflict' : '', this.error() ? 'create-error' : ''];
    return ids.filter(Boolean).join(' ') || null;
  });

  /** The key typed in a new stage drawer; follows the name until the user edits it. */
  protected stageKey = '';
  private stageKeyEdited = false;
  /** The frame picked in a new stage drawer. */
  protected stageFrameId = '';
  protected readonly maxStageKey = MAX_STAGE_KEY_LENGTH;

  /** The zone of a stage drawer. */
  protected readonly stageZoneId = computed(() => {
    const request = this.request();
    return request.kind === 'stage' || request.kind === 'renameStage' || request.kind === 'deleteStage'
      ? request.zoneId
      : '';
  });

  /** The frames a new stage can show: the zone's frames. */
  protected readonly stageFrames = computed(() => this.store.framesOf(this.stageZoneId()));

  /** The stage a rename or delete drawer is for. */
  protected readonly editedStage = computed(() => {
    const request = this.request();
    return request.kind === 'renameStage' || request.kind === 'deleteStage'
      ? this.store.stage(request.zoneId, request.stageId)
      : undefined;
  });

  /** Typing a stage name suggests its key, until the key is edited by hand. */
  protected stageNameChanged(name: string): void {
    if (!this.stageKeyEdited) this.stageKey = stageKeyFromName(name);
  }

  /** Any edit of the key by hand stops it following the name, even when it is emptied. */
  protected stageKeyChanged(): void {
    this.stageKeyEdited = true;
  }

  /** The tale group an "Add to zone…", "Copy to zone…", "Rename" or "Remove from this zone" drawer is for. */
  protected readonly placementGroup = computed(() => {
    const request = this.request();
    if (
      request.kind !== 'placeTaleGroup' &&
      request.kind !== 'removeTaleGroup' &&
      request.kind !== 'renameTaleGroup' &&
      request.kind !== 'copyTaleGroup'
    ) {
      return undefined;
    }
    return this.store.projectTaleGroup(request.taleGroupId) ?? this.store.taleGroup(request.taleGroupId);
  });

  /** The zones an "Add to zone…" drawer offers: the project's zones that do not hold the group yet. */
  protected readonly placeZones = computed(() => {
    const request = this.request();
    return request.kind === 'placeTaleGroup' ? this.store.zonesToPlace(request.taleGroupId) : [];
  });

  /** The project picked in a "Copy to zone…" drawer. */
  protected readonly copyProjectId = signal('');
  /** The zone picked in a "Copy to zone…" drawer. */
  protected readonly copyZoneId = signal('');
  /** The copy a "Copy to zone…" drawer made, with its zone; the drawer then shows only the result. */
  protected readonly copied = signal<{ name: string; zoneId: string; zoneName: string } | null>(null);

  /** The projects a copy can go to: every project the user can access, the group's own first. */
  protected readonly copyProjects = computed(() => {
    const own = this.placementGroup()?.projectId;
    const projects = this.store.projects();
    return [...projects.filter((p) => p.id === own), ...projects.filter((p) => p.id !== own)];
  });

  /** The zones of the picked project, where a copy can go. */
  protected readonly copyZones = computed(() => {
    const projectId = this.copyProjectId();
    return projectId ? this.store.zones().filter((z) => z.projectId === projectId) : [];
  });

  /** The zone a "Remove from this zone" drawer removes the group from. */
  protected readonly removeZone = computed(() => {
    const request = this.request();
    return request.kind === 'removeTaleGroup' ? this.store.zone(request.zoneId) : undefined;
  });

  /** The other zones that keep showing the group after it is removed from this one. */
  protected readonly keptZones = computed(() => {
    const request = this.request();
    const group = this.placementGroup();
    if (request.kind !== 'removeTaleGroup' || !group) return [];
    return group.zoneIds.flatMap((id) => {
      const zone = id === request.zoneId ? undefined : this.store.zone(id);
      return zone ? [zone.name] : [];
    });
  });

  /** True for the drawers whose submit removes or revokes something. */
  protected readonly destructive = computed(
    () =>
      this.zoneKeyRequest()?.action === 'revoke' ||
      this.request().kind === 'removeTaleGroup' ||
      this.request().kind === 'deleteStage',
  );

  /** The frame a settings drawer edits. */
  protected readonly settingsFrame = computed(() => {
    const request = this.request();
    if (request.kind !== 'frameSettings') return undefined;
    return this.store.framesOf(request.zoneId).find((f) => f.id === request.frameId);
  });

  /** The JSON Schema of that frame's type, which builds the form. */
  protected readonly settingsSchema = computed(() => {
    const frame = this.settingsFrame();
    return frame ? this.store.frameType(frame.type)?.schema : undefined;
  });

  /** The settings being edited: the stored ones, with schema defaults for missing fields. */
  protected readonly settings = signal<Settings>({});

  /** The field the API named when it refused the settings, as in "settings.gap must be at most 24". */
  protected readonly invalidSetting = linkedSignal(() => /^settings\.([A-Za-z0-9_]+)\b/.exec(this.error())?.[1] ?? '');

  /** Changing the refused field clears its invalid mark; the message stays until the next save. */
  protected settingChanged(key: string): void {
    if (this.invalidSetting() === key) this.invalidSetting.set('');
  }

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

  /** The tale group or tale a schedule drawer is for, with its name and current window. */
  protected readonly scheduleItem = computed(() => {
    const request = this.request();
    if (request.kind !== 'schedule') return undefined;
    if (request.target === 'tale') {
      const tale = this.store.tale(request.id);
      return tale && { name: tale.title, kind: 'tale', startsAt: tale.startsAt, endsAt: tale.endsAt };
    }
    const group = this.store.projectTaleGroup(request.id) ?? this.store.taleGroup(request.id);
    return group && { name: group.name, kind: 'tale group', startsAt: group.startsAt, endsAt: group.endsAt };
  });

  /** The start and end a schedule drawer's fields hold, as `datetime-local` values in the browser's time zone. */
  protected startText = '';
  protected endText = '';
  protected readonly timeZone = localTimeZone();
  protected readonly describeWindow = describeWindow;

  /**
   * Turns the tale drawer into the tale's schedule drawer. The drawer stays
   * open, so focus still returns to what opened the tale drawer.
   */
  protected openTaleSchedule(tale: Tale): void {
    this.store.drawer.set({ kind: 'schedule', target: 'tale', id: tale.id });
    this.error.set('');
    // The request input updates only after this handler, so the fields are filled from the tale itself.
    this.loadSchedule(tale);
  }

  // What each field showed when loaded, with the stored ISO time behind it. The field holds minutes only,
  // so an untouched field sends its stored time unchanged, seconds included.
  private loadedStart = { text: '', iso: null as string | null };
  private loadedEnd = { text: '', iso: null as string | null };

  private readonly startInput = viewChild<ElementRef<HTMLInputElement>>('scheduleStart');
  private readonly endInput = viewChild<ElementRef<HTMLInputElement>>('scheduleEnd');

  // Fills the schedule fields from a stored window, in the browser's time zone.
  private loadSchedule(window: { startsAt: string | null; endsAt: string | null } | undefined): void {
    const startsAt = window?.startsAt ?? null;
    const endsAt = window?.endsAt ?? null;
    this.loadedStart = { text: toLocalInput(startsAt), iso: startsAt };
    this.loadedEnd = { text: toLocalInput(endsAt), iso: endsAt };
    this.startText = this.loadedStart.text;
    this.endText = this.loadedEnd.text;
  }

  /** Removes the item's start and end time at once: saves no window and closes the drawer. */
  protected async removeSchedule(): Promise<void> {
    const request = this.request();
    if (request.kind !== 'schedule' || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    const message = await this.store.setSchedule(request.target, request.id, { startsAt: null, endsAt: null });
    this.saving.set(false);
    this.error.set(message);
    if (!message) this.close();
  }

  // One field's bound in UTC, or the message that refuses it.
  private scheduleBound(
    label: string,
    text: string,
    loaded: { text: string; iso: string | null },
    input: ElementRef<HTMLInputElement> | undefined,
  ): { iso: string | null } | { message: string } {
    // A half-typed date-time field reports '' as its value; only its validity tells it apart from an empty one.
    if (input?.nativeElement.validity?.badInput) {
      return { message: 'Enter a complete date and time, or leave it empty.' };
    }
    if (text === loaded.text) return { iso: loaded.iso };
    const result = parseLocalInput(text);
    if ('iso' in result) return result;
    return result.error === 'nonexistent'
      ? {
          message: `${label} ${text.replace('T', ' ')} does not exist in ${this.timeZone} because of a daylight-saving change. Pick another time.`,
        }
      : { message: 'Enter a complete date and time, or leave it empty.' };
  }

  // The window the schedule fields hold, in UTC, or the message that refuses it.
  private scheduleInput(): { schedule: SetScheduleRequest } | { message: string } {
    const start = this.scheduleBound('Start time', this.startText, this.loadedStart, this.startInput());
    if ('message' in start) return start;
    const end = this.scheduleBound('End time', this.endText, this.loadedEnd, this.endInput());
    if ('message' in end) return end;
    const startsAt = start.iso;
    const endsAt = end.iso;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      return { message: 'The end time must be later than the start time.' };
    }
    return { schedule: { startsAt, endsAt } };
  }

  /** The tale group a cover drawer is for. */
  protected readonly coverGroupId = computed(() => {
    const request = this.request();
    return request.kind === 'cover' ? request.taleGroupId : '';
  });

  private readonly coverEditor = viewChild(CoverEditor);

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
      case 'stage':
        return 'Add';
      case 'applyPlaybook':
        return 'Apply';
      case 'renameStage':
        return 'Save';
      case 'deleteStage':
        return 'Delete';
      case 'taleMedia':
        return 'Upload';
      case 'cover':
        return 'Save cover';
      case 'invite':
        return 'Create link';
      case 'tags':
      case 'renameTaleGroup':
      case 'schedule':
      case 'frameSettings':
        return 'Save';
      case 'placeTaleGroup':
        return 'Add';
      case 'copyTaleGroup':
        return 'Copy';
      case 'removeTaleGroup':
        return 'Remove';
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
  protected readonly showsResult = computed(
    () => this.invitation() !== null || this.issuedKey() !== null || this.copied() !== null,
  );

  protected readonly heading = computed(() => {
    switch (this.request().kind) {
      case 'project':
        return 'New project';
      case 'zone':
        return 'New zone';
      case 'frame':
        return 'Add frame';
      case 'frameSettings': {
        const frame = this.settingsFrame();
        return `${frame ? this.store.frameTypeLabel(frame.type) : 'Frame'} settings`;
      }
      case 'taleGroup':
        return 'New tale group';
      case 'tale':
        return 'Add tale';
      case 'taleMedia':
        return 'Tale';
      case 'cover':
        return 'Cover';
      case 'invite':
        return 'Invite to project';
      case 'tags':
        return 'Tags';
      case 'renameTaleGroup':
        return 'Rename tale group';
      case 'placeTaleGroup':
        return 'Add to zone';
      case 'copyTaleGroup':
        return 'Copy to zone';
      case 'removeTaleGroup':
        return 'Remove from this zone';
      case 'schedule':
        return 'Schedule';
      case 'stage':
        return 'New stage';
      case 'renameStage':
        return 'Rename stage';
      case 'deleteStage':
        return 'Delete stage';
      case 'applyPlaybook':
        return 'Apply playbook';
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
    if (
      request.kind === 'frame' ||
      request.kind === 'frameSettings' ||
      request.kind === 'taleGroup' ||
      request.kind === 'stage' ||
      request.kind === 'renameStage' ||
      request.kind === 'deleteStage' ||
      request.kind === 'applyPlaybook'
    ) {
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
    if (request.kind === 'placeTaleGroup' || request.kind === 'copyTaleGroup') {
      const group = this.placementGroup();
      return group ? `Tale group ${group.name}` : '';
    }
    if (request.kind === 'removeTaleGroup') {
      const zone = this.removeZone();
      return zone ? `In zone ${zone.name}` : '';
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
    if (request.kind === 'cover') {
      const group = this.store.taleGroup(request.taleGroupId);
      return group ? `Tale group ${group.name}` : '';
    }
    if (request.kind === 'schedule') {
      const item = this.scheduleItem();
      return item ? `${item.kind === 'tale' ? 'Tale' : 'Tale group'} ${item.name}` : '';
    }
    return '';
  });

  ngOnInit(): void {
    this.projectId = this.store.selectedProjectId();
    if (this.request().kind === 'schedule') this.loadSchedule(this.scheduleItem());
    this.selectedTagIds.set(this.tagGroup()?.tags.map((t) => t.id) ?? []);
    if (this.request().kind === 'renameTaleGroup') this.text = this.placementGroup()?.name ?? '';
    if (this.request().kind === 'renameStage') this.text = this.editedStage()?.name ?? '';
    if (this.request().kind === 'stage') this.stageFrameId = this.stageFrames()[0]?.id ?? '';
    const applied = this.playbookZone()?.playbookKey;
    if (applied && findPlaybook(applied)) this.playbookKey.set(applied);
    if (this.request().kind === 'copyTaleGroup') this.copyProjectId.set(this.copyProjects()[0]?.id ?? '');
    const frame = this.settingsFrame();
    if (frame) this.settings.set(initialSettings(this.settingsSchema(), frame.settings));
  }

  /** Picks the project of a copy; its zone has to be picked again. */
  protected pickCopyProject(projectId: string): void {
    this.copyProjectId.set(projectId);
    this.copyZoneId.set('');
    this.error.set('');
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

  protected readonly statusActions = statusActions;
  /** What the polite live region in the tale drawer last announced. */
  protected readonly statusAnnouncement = signal('');
  /** Why going live did not publish the tale's studio draft, shown under the status actions; '' for none. */
  protected readonly statusWarning = signal('');

  /** Publishes, pauses, archives or restores the drawer's tale; the drawer stays open and shows its new status. */
  protected async changeTaleStatus(taleId: string, status: SettableStatus): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    const { tale, message, warning } = await this.store.setTaleStatus(taleId, status);
    this.saving.set(false);
    this.error.set(message);
    this.statusWarning.set(warning);
    // The saved tale's status as read, from the API's answer, not the list that may still be loading.
    if (tale) this.statusAnnouncement.set(`Status: ${STATUS_LABELS[tale.status]}${warning ? `. ${warning}` : ''}`);
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
      case 'frameSettings':
        // A repeated refusal must mark its field again, so the old message goes first.
        this.error.set('');
        message = this.settingsFrame()
          ? await this.store.updateFrameSettings(request.zoneId, request.frameId, this.settings())
          : 'This frame no longer exists.';
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
      case 'renameTaleGroup':
        message = await this.store.renameTaleGroup(request.taleGroupId, this.text);
        break;
      case 'stage':
        message = !this.stageKey.trim()
          ? 'Enter a key: lowercase letters, digits and hyphens.'
          : this.stageFrameId
            ? await this.store.createStage(request.zoneId, {
                name: this.text,
                key: this.stageKey.trim(),
                frameId: this.stageFrameId,
              })
            : 'Choose a frame.';
        break;
      case 'renameStage':
        message = this.editedStage()
          ? await this.store.renameStage(request.zoneId, request.stageId, this.text)
          : 'This stage no longer exists.';
        break;
      case 'deleteStage':
        message = await this.store.deleteStage(request.zoneId, request.stageId);
        break;
      case 'applyPlaybook':
        // A conflict the dashboard can see is refused here, without a request; the API refuses it too.
        message = !this.pickedPlaybook()
          ? 'Choose a playbook.'
          : this.playbookConflict() || (await this.store.applyPlaybook(request.zoneId, this.playbookKey()));
        if (!message) {
          // The Apply playbook button that opened the drawer is gone once the zone has a playbook,
          // so focus returns to the Playbook section's heading instead.
          this.returnTo = this.document.getElementById('playbook-title');
        }
        break;
      case 'placeTaleGroup':
        message = this.placeZoneId()
          ? await this.store.placeTaleGroup(this.placeZoneId(), request.taleGroupId)
          : 'Choose a zone.';
        break;
      case 'removeTaleGroup':
        message = await this.store.removeTaleGroup(request.zoneId, request.taleGroupId);
        break;
      case 'copyTaleGroup': {
        const zoneId = this.copyZoneId();
        if (!zoneId) {
          message = 'Choose a zone.';
          break;
        }
        const { copy, message: refused } = await this.store.copyTaleGroup(request.taleGroupId, zoneId);
        if (copy) {
          const zone = this.store.zone(zoneId);
          // Name the project too when the copy went to another project: zone names repeat across projects.
          const zoneName = zone?.name ?? 'the zone';
          this.copied.set({
            name: copy.name,
            zoneId,
            zoneName: zone && zone.projectId !== this.store.selectedProjectId() ? `${zoneName} in ${this.store.projectName(zone.projectId)}` : zoneName,
          });
        }
        this.saving.set(false);
        this.error.set(refused);
        // The drawer stays open to say where the copy went, with a link there.
        return;
      }
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
      case 'cover':
        // A repeated refusal must show again, so the old message goes first.
        this.error.set('');
        message = (await this.coverEditor()?.save()) ?? 'This tale group no longer exists.';
        break;
      case 'schedule': {
        const input = this.scheduleInput();
        message =
          'message' in input ? input.message : await this.store.setSchedule(request.target, request.id, input.schedule);
        break;
      }
    }
    this.saving.set(false);
    this.error.set(message);
    if (!message) this.close();
  }
}
