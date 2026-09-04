declare const __WORDSNAP_DEV__: boolean;
/** Build target. Safari has no chrome.identity and grants site access per site, so a little copy differs. */
declare const __WORDSNAP_BROWSER__: 'chrome' | 'safari';
declare module '*.css' { const text: string; export default text; }
declare module '*.md' { const text: string; export default text; }
