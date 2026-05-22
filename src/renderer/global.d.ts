import type { UNDRCODAPI } from '../preload';

declare global {
  interface Window {
    undrcodAPI: UNDRCODAPI;
  }
}

declare module '*.svg' {
  const src: string;
  export default src;
}

export {};
