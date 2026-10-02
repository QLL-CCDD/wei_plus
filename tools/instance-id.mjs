import { getInstanceIdentity, normalizeAlternateUrl } from '../server/instance.js';
const value = process.argv.includes('--alternate-urls')
  ? { current: normalizeAlternateUrl(process.env.SP_CURRENT_ALTERNATE_URL), legacy: normalizeAlternateUrl(process.env.SP_LEGACY_ALTERNATE_URL) }
  : getInstanceIdentity();
console.log(JSON.stringify(value));
