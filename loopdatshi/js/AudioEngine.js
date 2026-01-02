// js/AudioEngine.js
export const AudioContext = window.AudioContext || window.webkitAudioContext;
export let audioCtx = null;

export function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

export function getAudioContext() {
    return audioCtx;
}