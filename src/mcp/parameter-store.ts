import { EventEmitter } from 'node:events';

export interface SongParameters {
  mood: 'chill' | 'melancholic' | 'upbeat';
  tempo: number;
  style: 'jazz' | 'hip-hop' | 'ambient';
  duration: number;
  mode?: 'text' | 'text-and-parameters' | 'parameters';
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
