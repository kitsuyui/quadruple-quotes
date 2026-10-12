/**
 * markdownlint evaluates a Node resolver while loading, even when its browser
 * entry point only uses bundled rules. Vite already transforms its static CJS
 * imports; this sentinel keeps that unused resolver from reading an absent
 * browser global. Any attempt to resolve a Node module still fails explicitly.
 */
type BrowserRequire = ((specifier: string) => never) & {
  resolve: (specifier: string) => never;
};

if (!("require" in globalThis)) {
  const unavailable = (specifier: string): never => {
    throw new Error(
      `Node module resolution is unavailable in browsers: ${specifier}`,
    );
  };
  const browserRequire = unavailable as BrowserRequire;
  browserRequire.resolve = unavailable;
  Object.assign(globalThis, { require: browserRequire });
}
