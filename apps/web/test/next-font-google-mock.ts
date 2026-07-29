/**
 * Vitest stand-in for `next/font/google`. The real module downloads/self-hosts fonts and is not
 * callable under the unit-test runner (`Fraunces is not a function`).
 */
function mockFont(variable: string) {
  return () => ({ className: "", variable, style: { fontFamily: variable } });
}

export const Fraunces = mockFont("--font-fraunces");
export const Nunito_Sans = mockFont("--font-nunito-sans");
export const IBM_Plex_Mono = mockFont("--font-ibm-plex-mono");
