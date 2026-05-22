/**
 * Audio feedback sutil pra eventos do agent.
 *
 * Toca samples MP3 curtos (piano notes do Antigravity) em transicoes
 * importantes — início de turn, tool use, done, error, cancel.
 *
 * Design (segue pattern Cursor/VS Code audioCues):
 *   - Opt-in: começa disabled, ativa via setting `audioEnabled`
 *   - Debounce 100ms por event pra evitar barrage em streaming rápido
 *   - Volume 0.3 (suficiente pra notar, não agressivo)
 *   - Reusa HTMLAudioElement por event (carrega 1x, replay com currentTime=0)
 *   - Silent fail se browser bloquear (user gesture não deu opt-in ainda)
 *
 * Eventos suportados (id = nome do arquivo .mp3 em assets/sounds/):
 *   start, complete, error, tool-use, tool-done, notification, cancel, idle
 */

const sounds: Record<string, HTMLAudioElement> = {};
let enabled = false;
const DEBOUNCE_MS = 100;
const lastPlay: Record<string, number> = {};

export type AudioEvent =
  | 'start'
  | 'complete'
  | 'error'
  | 'tool-use'
  | 'tool-done'
  | 'notification'
  | 'cancel'
  | 'idle';

export function setAudioEnabled(v: boolean): void {
  enabled = v;
}

export function getAudioEnabled(): boolean {
  return enabled;
}

export function playSound(event: AudioEvent): void {
  if (!enabled) return;
  const now = Date.now();
  if (lastPlay[event] && now - lastPlay[event] < DEBOUNCE_MS) return;
  lastPlay[event] = now;
  try {
    if (!sounds[event]) {
      // Vite resolve `new URL(..., import.meta.url)` pra path final do bundle
      const url = new URL(`../assets/sounds/${event}.mp3`, import.meta.url).href;
      sounds[event] = new Audio(url);
      sounds[event].volume = 0.3;
      sounds[event].preload = 'auto';
    }
    const clip = sounds[event];
    clip.currentTime = 0;
    // catch() pra silenciar NotAllowedError (autoplay sem user gesture)
    clip.play().catch(() => {
      /* silent fail — user não deu gesture ainda */
    });
  } catch {
    /* noop — Audio constructor falhou */
  }
}
