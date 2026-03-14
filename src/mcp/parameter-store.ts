import { EventEmitter } from 'node:events';

export interface SongParameters {
  duration: number;
  mode?: 'llm';
  prompt?: string;
}

export class ParameterStore extends EventEmitter {
  private params: SongParameters | null = null;

  set(params: SongParameters): void {
    this.params = { ...params };
    this.emit('update', this.params);
  }

  get(): SongParameters | null {
    return this.params ? { ...this.params } : null;
  }
}
