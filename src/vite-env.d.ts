/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VOLCANO_API_KEY: string
  readonly VITE_VOLCANO_MODEL_ID: string
  readonly VITE_USE_PROXY: string
  readonly PROD: boolean
  readonly DEV: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
