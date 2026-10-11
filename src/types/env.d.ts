interface ImportMetaEnv {
  /** Where sprites are served from. Defaults to "/sprites" (self-hosted); see README. */
  readonly VITE_SPRITE_BASE_URL?: string;
  /** Set by Vite: true under `vite` (the dev server), false in builds. */
  readonly DEV?: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
