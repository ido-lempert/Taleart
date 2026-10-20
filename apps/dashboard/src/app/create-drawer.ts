import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAX_TALES_PER_GROUP } from '@taleart/contract';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { Drawer } from './drawer';

/** The create form for whatever the store's drawer request asks for. The API's message shows inside it. */
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
    return '';
  });

  ngOnInit(): void {
    this.projectId = this.store.selectedProjectId();
  }

  protected close(): void {
    this.store.closeDrawer();
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const request = this.request();
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
        message = await this.store.createTale(request.taleGroupId, this.text);
        break;
    }
    this.saving.set(false);
    this.error.set(message);
    if (!message) this.close();
  }
}
