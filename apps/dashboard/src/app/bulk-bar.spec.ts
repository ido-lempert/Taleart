import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { BulkBar } from './bulk-bar';

@Component({
  imports: [BulkBar],
  template: `
    <app-bulk-bar [count]="count()" (cleared)="cleared = cleared + 1">
      <button type="button" id="go">Go</button>
    </app-bulk-bar>
  `,
})
class HostComponent {
  readonly count = signal(0);
  cleared = 0;
}

describe('BulkBar', () => {
  let fixture: ComponentFixture<HostComponent>;
  let root: HTMLElement;
  let host: HostComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  const bar = () => root.querySelector<HTMLElement>('[role=region][aria-label="Actions on the selection"]');

  it('is not shown while nothing is selected', () => {
    expect(bar()).toBeNull();
    expect(root.querySelector('#go')).toBeNull();
  });

  it('shows the region with the count, the projected actions and Clear selection', () => {
    host.count.set(2);
    fixture.detectChanges();
    expect(bar()).not.toBeNull();
    expect(bar()?.querySelector('.bulk-bar__count')?.textContent?.trim()).toBe('2 selected');
    expect(bar()?.querySelector('#go')).not.toBeNull();
    expect(bar()?.querySelector('button.bulk-bar__clear')?.textContent?.trim()).toBe('Clear selection');
  });

  it('announces the count politely through a live region that stays in place', () => {
    const live = () => root.querySelector<HTMLElement>('[aria-live=polite]');
    expect(live()?.textContent?.trim()).toBe('0 selected');
    host.count.set(3);
    fixture.detectChanges();
    expect(live()?.textContent?.trim()).toBe('3 selected');
  });

  it('emits cleared when Clear selection is pressed', () => {
    host.count.set(1);
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.bulk-bar__clear')?.click();
    expect(host.cleared).toBe(1);
  });

  it('hides again when the count returns to 0', () => {
    host.count.set(1);
    fixture.detectChanges();
    host.count.set(0);
    fixture.detectChanges();
    expect(bar()).toBeNull();
  });
});
