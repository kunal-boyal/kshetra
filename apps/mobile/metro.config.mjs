import { ServerResponse } from 'node:http';
// expo has no exports map, so ES modules name the file.
import expoMetro from 'expo/metro-config.js';

/**
 * Expo's defaults, plus what the phone's database (expo-sqlite) needs in the web preview: its
 * WebAssembly build, and a cross-origin isolated page, without which a browser keeps back the
 * shared memory it uses. Phones need neither.
 */
const config = expoMetro.getDefaultConfig(import.meta.dirname);

config.resolver.assetExts.push('wasm');

// Expo's dev server answers the page itself before any middleware the config adds, so the
// isolation headers go on every response this process writes. Only the dev server runs this.
const writeHead = ServerResponse.prototype.writeHead;
ServerResponse.prototype.writeHead = function isolated(...args) {
  if (!this.headersSent) {
    this.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    this.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }
  return writeHead.apply(this, args);
};

export default config;
