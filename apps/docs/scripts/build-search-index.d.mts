// Types for build-search-index.mjs, so the docs' specs can import its parsing functions.
import type { SearchIndex } from '../src/app/search';

export interface PageEntry {
  path: string;
  title: string;
  group: string;
  file: string;
}

export interface Section {
  anchor: string;
  heading: string;
  body: string;
}

export function readPages(routesSource: string): PageEntry[];
export function templatesOf(source: string): string[];
export function sectionsOf(markup: string): Section[];
export function buildIndex(routesSource: string, readPage: (file: string) => string): SearchIndex;
