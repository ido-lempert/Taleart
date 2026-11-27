import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createSelection } from './selection';

describe('createSelection', () => {
  function setup(initial: string[] = ['a', 'b', 'c']) {
    const rows = signal(initial.map((id) => ({ id, name: id.toUpperCase() })));
    const selection = TestBed.runInInjectionContext(() => createSelection(() => rows(), (row) => row.id));
    return { rows, selection };
  }

  it('starts with nothing selected', () => {
    const { selection } = setup();
    expect(selection.count()).toBe(0);
    expect(selection.ids().size).toBe(0);
    expect(selection.allSelected()).toBe(false);
    expect(selection.someSelected()).toBe(false);
  });

  it('toggles one item on and off', () => {
    const { selection } = setup();
    selection.toggle('b');
    expect(selection.isSelected('b')).toBe(true);
    expect(selection.count()).toBe(1);
    selection.toggle('b');
    expect(selection.isSelected('b')).toBe(false);
    expect(selection.count()).toBe(0);
  });

  it('ignores an id the list does not show', () => {
    const { selection } = setup();
    selection.toggle('zz');
    selection.set('zz', true);
    expect(selection.count()).toBe(0);
  });

  it('set() selects or clears one visible item', () => {
    const { selection } = setup();
    selection.set('a', true);
    selection.set('a', true);
    expect(selection.count()).toBe(1);
    selection.set('a', false);
    expect(selection.count()).toBe(0);
  });

  it('toggleAll selects every visible item, then clears them all', () => {
    const { selection } = setup();
    selection.toggleAll();
    expect(selection.count()).toBe(3);
    expect(selection.allSelected()).toBe(true);
    expect(selection.someSelected()).toBe(false);
    selection.toggleAll();
    expect(selection.count()).toBe(0);
  });

  it('reports the indeterminate state when some but not all are selected', () => {
    const { selection } = setup();
    selection.toggle('a');
    expect(selection.someSelected()).toBe(true);
    expect(selection.allSelected()).toBe(false);
    selection.toggle('b');
    selection.toggle('c');
    expect(selection.allSelected()).toBe(true);
    expect(selection.someSelected()).toBe(false);
  });

  it('is never all-selected for an empty list', () => {
    const { selection, rows } = setup([]);
    expect(rows().length).toBe(0);
    expect(selection.allSelected()).toBe(false);
    selection.toggleAll();
    expect(selection.count()).toBe(0);
  });

  it('returns the selected items in list order', () => {
    const { selection } = setup();
    selection.toggle('c');
    selection.toggle('a');
    expect(selection.selectedItems().map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('drops a selected id once its item leaves the list, and does not bring it back', () => {
    const { selection, rows } = setup();
    selection.toggle('a');
    selection.toggle('b');
    rows.set([{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
    expect(selection.count()).toBe(1);
    expect(selection.isSelected('a')).toBe(false);
    TestBed.flushEffects();
    rows.set([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]);
    TestBed.flushEffects();
    expect(selection.isSelected('a')).toBe(false);
    expect(selection.isSelected('b')).toBe(true);
    expect(selection.count()).toBe(1);
  });

  it('replace() selects exactly the given visible ids', () => {
    const { selection } = setup();
    selection.toggle('a');
    selection.replace(['b', 'c', 'missing']);
    expect([...selection.ids()].sort()).toEqual(['b', 'c']);
  });

  it('clear() drops the whole selection', () => {
    const { selection } = setup();
    selection.toggleAll();
    selection.clear();
    expect(selection.count()).toBe(0);
    expect(selection.allSelected()).toBe(false);
  });
});
