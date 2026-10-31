// The demo seed (`taleart seed-demo`, and TALEART_SEED_DEMO=true on the API): a ready project with
// zones, tale groups, tales and pictures, made through the Management API.
export { seedDemo, SeedRefusedError, type SeedClient, type SeedCounts, type SeedOptions, type SeedResult } from './lib/seed';
export { DEMO_BRAND, DEMO_GROUPS, DEMO_PROJECT_NAME, DEMO_TEAM, DEMO_ZONES, demoCounts } from './lib/content';
