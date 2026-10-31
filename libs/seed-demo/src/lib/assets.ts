// The apps that bundle this lib read it with their own tsconfig, so the `?inline` types travel with it.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../inline.d.ts" />
// The demo's pictures, inlined at build time as data URLs (src/inline.d.ts), so the CLI stays one file and the API image needs no
// extra folder. Drawn by scripts/render-assets.mjs; src/assets/LICENSES.md names their source and licence.
import p_c_care_tips from '../assets/c-care-tips.jpg?inline';
import p_c_living_room from '../assets/c-living-room.jpg?inline';
import p_c_makers from '../assets/c-makers.jpg?inline';
import p_c_new_arrivals from '../assets/c-new-arrivals.jpg?inline';
import p_c_spring_sale from '../assets/c-spring-sale.jpg?inline';
import p_s01_fjord_sofa from '../assets/s01-fjord-sofa.jpg?inline';
import p_s02_lumi_armchair from '../assets/s02-lumi-armchair.jpg?inline';
import p_s03_aura_lamp from '../assets/s03-aura-lamp.jpg?inline';
import p_s04_spring_sale from '../assets/s04-spring-sale.jpg?inline';
import p_s05_promo_code from '../assets/s05-promo-code.jpg?inline';
import p_s06_sofa_duel from '../assets/s06-sofa-duel.jpg?inline';
import p_s07_cosy_corner from '../assets/s07-cosy-corner.jpg?inline';
import p_s08_wood_quiz from '../assets/s08-wood-quiz.jpg?inline';
import p_s09_rate_room from '../assets/s09-rate-room.jpg?inline';
import p_s10_oak_care from '../assets/s10-oak-care.jpg?inline';
import p_s11_linen_care from '../assets/s11-linen-care.jpg?inline';
import p_s12_forest_table from '../assets/s12-forest-table.jpg?inline';
import p_s13_workshop from '../assets/s13-workshop.jpg?inline';

const DATA_URLS = {
  'c-care-tips': p_c_care_tips,
  'c-living-room': p_c_living_room,
  'c-makers': p_c_makers,
  'c-new-arrivals': p_c_new_arrivals,
  'c-spring-sale': p_c_spring_sale,
  's01-fjord-sofa': p_s01_fjord_sofa,
  's02-lumi-armchair': p_s02_lumi_armchair,
  's03-aura-lamp': p_s03_aura_lamp,
  's04-spring-sale': p_s04_spring_sale,
  's05-promo-code': p_s05_promo_code,
  's06-sofa-duel': p_s06_sofa_duel,
  's07-cosy-corner': p_s07_cosy_corner,
  's08-wood-quiz': p_s08_wood_quiz,
  's09-rate-room': p_s09_rate_room,
  's10-oak-care': p_s10_oak_care,
  's11-linen-care': p_s11_linen_care,
  's12-forest-table': p_s12_forest_table,
  's13-workshop': p_s13_workshop,
} as const;

/** A picture's name: its file name without `.jpg`. `s…` are 1080x1920 story frames, `c…` 720x720 covers. */
export type AssetName = keyof typeof DATA_URLS;

/** Every picture name, in order. */
export const ASSET_NAMES = Object.keys(DATA_URLS) as AssetName[];

/** The picture's JPEG bytes. */
export function assetBytes(name: AssetName): Buffer {
  const url: string = DATA_URLS[name];
  const comma = url.indexOf(',');
  if (!url.startsWith('data:image/jpeg;base64,') || comma < 0) throw new Error(`The picture ${name} is not an inlined JPEG`);
  return Buffer.from(url.slice(comma + 1), 'base64');
}
