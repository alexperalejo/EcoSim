/// <reference types="vite/client" />

// Allow importing .glsl files as raw strings via ?raw suffix
declare module '*.glsl?raw' {
  const value: string;
  export default value;
}
