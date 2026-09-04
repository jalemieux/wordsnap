/** Types for manifest.mjs so the unit test can import it under strict TypeScript. */
export type Manifest = Record<string, any>;
export function safariManifest(chrome: Manifest): Manifest;
