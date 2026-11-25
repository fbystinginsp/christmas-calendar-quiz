import { createSharePointStore } from './sharepoint.js';
import { createMemoryStore } from './memory.js';

let instance;
export function getStore() {
  instance ??= process.env.STORE === 'memory' ? createMemoryStore() : createSharePointStore();
  return instance;
}
