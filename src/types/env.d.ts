interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite's `?worker` import suffix returns a Worker constructor.
declare module "*?worker" {
  const workerCtor: new () => Worker;
  export default workerCtor;
}
