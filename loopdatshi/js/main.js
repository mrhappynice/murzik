import { initAudioContext, getAudioContext } from './AudioEngine.js';
import { Track } from './Track.js';
import { bufferToWav } from './WavEncoder.js';

// --- State ---
let tracks = [];
let mediaRecorder;
let chunks = [];
let selectedTrackId = null;
let currentStream = null;
let globalPlaybackRate = 1.0; // Global Tempo
const TIMELINE_SCALE = 60; // pixels per second
const MIN_CLIP_DURATION = 0.2;
const DEFAULT_TIMELINE_SECONDS = 60;

let clips = [];
let clipIdCounter = 1;
let arrangementSources = [];
let arrangementPlaying = false;
let arrangementStartTime = 0;
let loopEnabled = false;
let loopTimer = null;
let loopRegion = { start: 0, end: 8 };
let timelineSecondsState = DEFAULT_TIMELINE_SECONDS;
let bpm = 120;
let beatsPerBar = 4;
let gridDivision = 4; // 1=quarter, 2=eighth, 4=sixteenth, 8=thirty-second
let snapEnabled = true;

let padBank = Array.from({ length: 8 }, (_, i) => ({
    name: `Pad ${i + 1}`,
    buffer: null
}));
let selectedPadIndex = 0;
let padQuantizeEnabled = true;
let padRecorder = null;
let padChunks = [];
let padStream = null;
let drumRecording = false;
let drumPattern = { events: [], length: 0 };

// --- UI References ---
const recordBtn = document.getElementById('recordBtn');
const trackList = document.getElementById('trackList');
const emptyState = document.getElementById('emptyState');
const xyPad = document.getElementById('xyPad');
const xyCursor = document.getElementById('xyCursor');
const fxControls = document.getElementById('fxControls');
const noTrackSelectedMsg = document.getElementById('noTrackSelectedMsg');
const selectedTrackName = document.getElementById('selectedTrackName');
const effectButtons = document.querySelectorAll('.effect-btn');
const globalRateSlider = document.getElementById('globalRateSlider');
const globalRateLabel = document.getElementById('globalRateLabel');
const resampleBtn = document.getElementById('resampleBtn');
const loadAudioBtn = document.getElementById('loadAudioBtn');
const audioFileInput = document.getElementById('audioFileInput');
const bpmInput = document.getElementById('bpmInput');
const gridSelect = document.getElementById('gridSelect');
const snapToggleBtn = document.getElementById('snapToggleBtn');
const timelineBody = document.getElementById('timelineBody');
const timelineRuler = document.getElementById('timelineRuler');
const timelineEl = document.querySelector('.timeline');
const loopToggleBtn = document.getElementById('loopToggleBtn');
const timelineLoopOverlay = document.getElementById('timelineLoopOverlay');
const padGrid = document.getElementById('padGrid');
const selectedPadLabel = document.getElementById('selectedPadLabel');
const padLoadBtn = document.getElementById('padLoadBtn');
const padRecordBtn = document.getElementById('padRecordBtn');
const padQuantizeBtn = document.getElementById('padQuantizeBtn');
const padPatternRecordBtn = document.getElementById('padPatternRecordBtn');
const padPatternClearBtn = document.getElementById('padPatternClearBtn');
const padFileInput = document.getElementById('padFileInput');
const saveDrumPresetBtn = document.getElementById('saveDrumPresetBtn');
const loadDrumPresetBtn = document.getElementById('loadDrumPresetBtn');
const drumPresetInput = document.getElementById('drumPresetInput');

if (loopToggleBtn) {
    loopToggleBtn.addEventListener('click', () => {
        loopEnabled = !loopEnabled;
        loopToggleBtn.innerText = loopEnabled ? "Loop Region: On" : "Loop Region: Off";
        loopToggleBtn.style.background = loopEnabled ? "#2a8a58" : "#d68a28";
        updateLoopRegionUI();
        if (arrangementPlaying) playArrangement();
    });
}

// --- Global Tempo Listener ---
if (globalRateSlider) {
    globalRateSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        globalPlaybackRate = val;
        globalRateLabel.innerText = `${val.toFixed(2)}x`;
        
        // Update all playing tracks immediately
        tracks.forEach(t => t.updateLivePlaybackRate(globalPlaybackRate));
    });
    // Double click to reset
    globalRateSlider.addEventListener('dblclick', () => {
        globalRateSlider.value = 1.0;
        globalPlaybackRate = 1.0;
        globalRateLabel.innerText = "1.00x";
        tracks.forEach(t => t.updateLivePlaybackRate(globalPlaybackRate));
    });
}

function getSecondsPerBeat() {
    return 60 / Math.max(1, bpm);
}

function getGridStepSeconds() {
    return getSecondsPerBeat() / Math.max(1, gridDivision);
}

function snapTime(seconds) {
    const step = getGridStepSeconds();
    if (!step) return seconds;
    return Math.round(seconds / step) * step;
}

function isSnapActive(e = null) {
    if (!snapEnabled) return false;
    return !(e && e.altKey);
}

function updateSnapToggleUI() {
    if (!snapToggleBtn) return;
    snapToggleBtn.innerText = snapEnabled ? "Snap: On" : "Snap: Off";
    snapToggleBtn.style.background = snapEnabled ? "#2a8a58" : "#444";
}

function updatePadQuantizeUI() {
    if (!padQuantizeBtn) return;
    padQuantizeBtn.innerText = padQuantizeEnabled ? "Pad Quantize: On" : "Pad Quantize: Off";
    padQuantizeBtn.style.background = padQuantizeEnabled ? "#2a8a58" : "#444";
}

function updateDrumRecordUI() {
    if (!padPatternRecordBtn) return;
    padPatternRecordBtn.innerText = drumRecording ? "Stop Pattern" : "Record Pattern";
    padPatternRecordBtn.style.background = drumRecording ? "#ff4444" : "#444";
}

function getDrumRowHeight() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--drum-row-height'), 10) || 120;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

if (bpmInput) {
    const initial = parseFloat(bpmInput.value);
    if (Number.isFinite(initial)) bpm = initial;
    bpmInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!Number.isFinite(val)) return;
        bpm = Math.max(40, Math.min(240, val));
        bpmInput.value = bpm;
        renderTimeline();
    });
}

if (gridSelect) {
    const initial = parseInt(gridSelect.value, 10);
    if (Number.isFinite(initial)) gridDivision = initial;
    gridSelect.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        gridDivision = Number.isFinite(val) ? val : 4;
        renderTimeline();
    });
}

if (snapToggleBtn) {
    updateSnapToggleUI();
    snapToggleBtn.addEventListener('click', () => {
        snapEnabled = !snapEnabled;
        updateSnapToggleUI();
    });
}

// --- Recording ---
async function toggleRecording() {
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    if (recordBtn.classList.contains('active')) {
        // Stop
        if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }
        recordBtn.classList.remove('active');
        recordBtn.innerHTML = `● REC <span class="shortcut">(Space)</span>`;
    } else {
        // Start
        try {
            const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }};
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            currentStream = stream;

            mediaRecorder = new MediaRecorder(stream);
            chunks = [];
            mediaRecorder.ondataavailable = e => chunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunks, { 'type' : 'audio/ogg; codecs=opus' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                createTrack(audioBuffer);
            };
            mediaRecorder.start();
            recordBtn.classList.add('active');
            recordBtn.innerText = "■ STOP (Space)";
        } catch (err) {
            alert("Microphone Error: " + err.message);
        }
    }
}

document.addEventListener('keydown', (e) => {
    // Ignore spacebar if user is typing in a text box
    if (e.code === "Space" && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        toggleRecording();
    }
});
recordBtn.addEventListener('click', toggleRecording);

const PAD_KEYS = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f'];
function getPadIndexForKey(key) {
    const idx = PAD_KEYS.indexOf(key.toLowerCase());
    return idx === -1 ? null : idx;
}

document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const idx = getPadIndexForKey(e.key);
    if (idx === null) return;
    selectPad(idx);
    playPad(idx, padQuantizeEnabled, true);
    const btn = document.querySelector(`.pad-btn[data-pad="${idx}"]`);
    if (btn) btn.classList.add('active');
});

document.addEventListener('keyup', (e) => {
    const idx = getPadIndexForKey(e.key);
    if (idx === null) return;
    const btn = document.querySelector(`.pad-btn[data-pad="${idx}"]`);
    if (btn) btn.classList.remove('active');
});

// --- Load Audio Files ---
async function handleAudioFile(file) {
    if (!file) return;
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    createTrack(audioBuffer);
}

if (loadAudioBtn && audioFileInput) {
    loadAudioBtn.addEventListener('click', () => audioFileInput.click());
    audioFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            await handleAudioFile(file);
        } catch (err) {
            alert("Load failed: " + err.message);
        } finally {
            audioFileInput.value = '';
        }
    });
}

// --- Drum Pads ---
function selectPad(index) {
    selectedPadIndex = Math.max(0, Math.min(padBank.length - 1, index));
    if (selectedPadLabel) {
        const key = PAD_KEYS[selectedPadIndex] ? PAD_KEYS[selectedPadIndex].toUpperCase() : '';
        selectedPadLabel.innerText = `${padBank[selectedPadIndex].name}${key ? ` (${key})` : ''}`;
    }
    document.querySelectorAll('.pad-btn').forEach(btn => {
        const isSelected = parseInt(btn.dataset.pad, 10) === selectedPadIndex;
        btn.classList.toggle('selected', isSelected);
    });
}

function updatePadButtonUI(index) {
    const btn = document.querySelector(`.pad-btn[data-pad="${index}"]`);
    if (!btn) return;
    const isLoaded = !!padBank[index].buffer;
    btn.classList.toggle('loaded', isLoaded);
}

function recordPadEvent(index, when) {
    if (!drumRecording) return;
    const baseLength = loopEnabled ? (loopRegion.end - loopRegion.start) : (beatsPerBar * getSecondsPerBeat());
    const loopLength = Math.max(MIN_CLIP_DURATION, baseLength);
    const timelinePos = when - arrangementStartTime;
    let posInLoop = loopEnabled ? (timelinePos - loopRegion.start) : timelinePos;
    posInLoop = ((posInLoop % loopLength) + loopLength) % loopLength;
    if (padQuantizeEnabled) {
        const step = getGridStepSeconds();
        if (step > 0) posInLoop = Math.round(posInLoop / step) * step;
    }
    if (posInLoop < 0 || posInLoop > loopLength) return;
    drumPattern.length = loopLength;
    addDrumHit(index, posInLoop, true);
    renderTimeline();
}

function playPad(index, quantize, shouldRecord = false) {
    const ctx = initAudioContext();
    const pad = padBank[index];
    if (!pad || !pad.buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = pad.buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    let startTime = now + 0.01;
    if (quantize) {
        const step = getGridStepSeconds();
        if (step > 0) {
            startTime = Math.ceil(startTime / step) * step;
        }
    }
    source.start(startTime);
    if (shouldRecord) recordPadEvent(index, startTime);
}

function addDrumHit(padIndex, timeSec, allowDuplicate = false) {
    const step = getGridStepSeconds();
    const snapped = step > 0 ? Math.round(timeSec / step) * step : timeSec;
    const keyTime = parseFloat(snapped.toFixed(4));
    if (!loopEnabled && drumPattern.length === 0) {
        drumPattern.length = beatsPerBar * getSecondsPerBeat();
    }
    if (!allowDuplicate) {
        const existingIndex = drumPattern.events.findIndex(ev => ev.padIndex === padIndex && Math.abs(ev.time - keyTime) < 0.0005);
        if (existingIndex !== -1) {
            drumPattern.events.splice(existingIndex, 1);
            return false;
        }
    }
    drumPattern.events.push({ time: keyTime, padIndex });
    return true;
}

async function handlePadFile(file) {
    if (!file) return;
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    padBank[selectedPadIndex].buffer = audioBuffer;
    updatePadButtonUI(selectedPadIndex);
}

async function togglePadRecording() {
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    if (padRecorder && padRecorder.state !== 'inactive') {
        padRecorder.stop();
        return;
    }

    try {
        const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }};
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        padStream = stream;
        padRecorder = new MediaRecorder(stream);
        padChunks = [];
        padRecorder.ondataavailable = e => padChunks.push(e.data);
        padRecorder.onstop = async () => {
            try {
                const blob = new Blob(padChunks, { 'type' : 'audio/ogg; codecs=opus' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                padBank[selectedPadIndex].buffer = audioBuffer;
                updatePadButtonUI(selectedPadIndex);
            } catch (err) {
                alert("Pad record failed: " + err.message);
            } finally {
                if (padStream) {
                    padStream.getTracks().forEach(track => track.stop());
                    padStream = null;
                }
                if (padRecordBtn) {
                    padRecordBtn.classList.remove('active');
                    padRecordBtn.innerText = "Record Pad";
                }
            }
        };
        padRecorder.start();
        if (padRecordBtn) {
            padRecordBtn.classList.add('active');
            padRecordBtn.innerText = "Stop Pad";
        }
    } catch (err) {
        alert("Microphone Error: " + err.message);
    }
}

if (padGrid) {
    selectPad(0);
    padGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('.pad-btn');
        if (!btn) return;
        const index = parseInt(btn.dataset.pad, 10);
        selectPad(index);
        playPad(index, padQuantizeEnabled, true);
    });
}

if (padLoadBtn && padFileInput) {
    padLoadBtn.addEventListener('click', () => padFileInput.click());
    padFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            await handlePadFile(file);
        } catch (err) {
            alert("Pad load failed: " + err.message);
        } finally {
            padFileInput.value = '';
        }
    });
}

if (padRecordBtn) {
    padRecordBtn.addEventListener('click', togglePadRecording);
}

if (padQuantizeBtn) {
    updatePadQuantizeUI();
    padQuantizeBtn.addEventListener('click', () => {
        padQuantizeEnabled = !padQuantizeEnabled;
        updatePadQuantizeUI();
    });
}

if (padPatternRecordBtn) {
    updateDrumRecordUI();
    padPatternRecordBtn.addEventListener('click', () => {
        drumRecording = !drumRecording;
        if (drumRecording && !arrangementPlaying) {
            playArrangement();
        }
        updateDrumRecordUI();
    });
}

if (padPatternClearBtn) {
    padPatternClearBtn.addEventListener('click', () => {
        drumPattern.events = [];
        renderTimeline();
    });
}

// --- Drum Presets ---
async function exportDrumPreset() {
    const preset = {
        version: 1,
        pads: []
    };

    for (let i = 0; i < padBank.length; i++) {
        const pad = padBank[i];
        let sample = null;
        if (pad.buffer) {
            const wavBlob = bufferToWav(pad.buffer, pad.buffer.length);
            sample = await blobToDataUrl(wavBlob);
        }
        preset.pads.push({
            name: pad.name,
            key: PAD_KEYS[i] ? PAD_KEYS[i].toUpperCase() : '',
            sample
        });
    }

    const blob = new Blob([JSON.stringify(preset)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drum_preset_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

async function importDrumPreset(file) {
    const ctx = initAudioContext();
    const text = await file.text();
    let preset;
    try {
        preset = JSON.parse(text);
    } catch (err) {
        alert("Invalid preset file.");
        return;
    }
    if (!preset || !Array.isArray(preset.pads)) {
        alert("Invalid preset structure.");
        return;
    }

    for (let i = 0; i < padBank.length; i++) {
        const data = preset.pads[i];
        padBank[i].name = data && data.name ? data.name : `Pad ${i + 1}`;
        padBank[i].buffer = null;
        if (data && data.sample) {
            try {
                const arrayBuffer = await fetch(data.sample).then(res => res.arrayBuffer());
                padBank[i].buffer = await ctx.decodeAudioData(arrayBuffer);
            } catch (err) {
                console.warn("Failed to load pad sample", i, err);
            }
        }
        updatePadButtonUI(i);
    }
    selectPad(selectedPadIndex);
    renderTimeline();
}

if (saveDrumPresetBtn) {
    saveDrumPresetBtn.addEventListener('click', () => {
        exportDrumPreset();
    });
}

if (loadDrumPresetBtn && drumPresetInput) {
    loadDrumPresetBtn.addEventListener('click', () => drumPresetInput.click());
    drumPresetInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            await importDrumPreset(file);
        } catch (err) {
            alert("Preset load failed: " + err.message);
        } finally {
            drumPresetInput.value = '';
        }
    });
}

// --- Track Management ---
function createTrack(buffer) {
    if(emptyState) emptyState.style.display = 'none';
    const id = Date.now();
    const name = `Loop ${tracks.length + 1}`;
    
    const newTrack = new Track(id, buffer, name);
    tracks.push(newTrack);
    
    renderTrackUI(newTrack);
    selectTrack(id);

    const clipDuration = getDefaultClipDuration(newTrack);
    createClip(id, 0, clipDuration);
    
    // Play immediately using current global rate
    newTrack.play(globalPlaybackRate);
    updatePlayButtonUI(id, true);
}

function renderTrackUI(track) {
    const div = document.createElement('div');
    div.className = 'loop-item';
    div.id = `track-${track.id}`;
    
    div.innerHTML = `
        <button class="track-play-btn" id="play-btn-${track.id}">▶</button>
        
        <div class="loop-center">
            <!-- Name Input -->
            <input type="text" class="loop-name-input" value="${track.name}" id="name-${track.id}">
            
            <div class="loop-waveform">
                <div class="waveform-bar" style="width:100%"></div>
            </div>
            
            <div class="controls-row">
                <div class="control-group">
                    <span>Trim</span>
                    <input class="slider-mini" type="range" min="0" max="100" value="0" data-id="${track.id}" data-type="start">
                    <input class="slider-mini" type="range" min="0" max="100" value="100" data-id="${track.id}" data-type="end">
                </div>
                <div class="control-group">
                    <span>Speed</span>
                    <input class="slider-mini" type="range" min="0.1" max="2.0" step="0.05" value="1.0" data-id="${track.id}" data-type="speed" title="Double click to reset">
                </div>
            </div>
        </div>

        <button class="select-btn" id="sel-btn-${track.id}">EDIT FX</button>
        <button class="delete-btn" data-id="${track.id}">✕</button>
    `;

    // Listeners
    div.querySelector(`#play-btn-${track.id}`).onclick = () => togglePlay(track.id);
    div.querySelector(`#sel-btn-${track.id}`).onclick = () => selectTrack(track.id);
    div.querySelector(`.delete-btn`).onclick = () => deleteTrack(track.id);
    
    // Name Change Listener
    const nameInput = div.querySelector(`#name-${track.id}`);
    nameInput.addEventListener('change', (e) => {
        track.name = e.target.value;
        if(selectedTrackId === track.id) selectedTrackName.innerText = track.name;
        renderTimeline();
    });
    // Stop spacebar from triggering record when typing name
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());

    // Slider Listeners
    div.querySelectorAll('input[type="range"]').forEach(input => {
        input.oninput = (e) => {
            const val = parseFloat(e.target.value);
            const type = e.target.dataset.type;

            if (type === 'start') {
                track.trimStart = val / 100;
                if(track.isPlaying) track.play(globalPlaybackRate); // Restart to sync trim
            } 
            else if (type === 'end') {
                track.trimEnd = val / 100;
                if(track.isPlaying) track.play(globalPlaybackRate);
            }
            else if (type === 'speed') {
                track.setLocalRate(val);
                track.updateLivePlaybackRate(globalPlaybackRate);
            }
        };
        
        // Reset speed on double click
        if (input.dataset.type === 'speed') {
            input.addEventListener('dblclick', (e) => {
                e.target.value = 1.0;
                track.setLocalRate(1.0);
                track.updateLivePlaybackRate(globalPlaybackRate);
            });
        }
    });

    trackList.appendChild(div);
}

// --- Logic ---
function togglePlay(id) {
    initAudioContext();
    const track = tracks.find(t => t.id === id);
    if (!track) return;

    if (track.isPlaying) {
        track.stop();
        updatePlayButtonUI(id, false);
    } else {
        track.play(globalPlaybackRate);
        updatePlayButtonUI(id, true);
    }
}

function updatePlayButtonUI(id, isPlaying) {
    const btn = document.getElementById(`play-btn-${id}`);
    if(btn) {
        btn.classList.toggle('playing', isPlaying);
        btn.innerHTML = isPlaying ? "■" : "▶";
    }
}

function deleteTrack(id) {
    const track = tracks.find(t => t.id === id);
    if(track) track.destroy();
    
    tracks = tracks.filter(t => t.id !== id);
    clips = clips.filter(c => c.trackId !== id);
    const el = document.getElementById(`track-${id}`);
    if(el) el.remove();
    
    if(selectedTrackId === id) deselectAll();
    renderTimeline();
}

// --- Selection & FX ---
function selectTrack(id) {
    selectedTrackId = id;
    document.querySelectorAll('.loop-item').forEach(el => el.classList.remove('selected'));
    const trackEl = document.getElementById(`track-${id}`);
    if(trackEl) trackEl.classList.add('selected');

    document.querySelectorAll('.select-btn').forEach(b => {
        b.classList.remove('active');
        b.innerText = "EDIT FX";
    });
    const selBtn = document.getElementById(`sel-btn-${id}`);
    if(selBtn) {
        selBtn.classList.add('active');
        selBtn.innerText = "EDITING";
    }

    if(noTrackSelectedMsg) noTrackSelectedMsg.classList.add('hidden');
    if(fxControls) fxControls.classList.remove('hidden');
    
    const track = tracks.find(t => t.id === id);
    if(selectedTrackName) selectedTrackName.innerText = track.name;
    
    effectButtons.forEach(btn => {
        btn.classList.remove('selected');
        if(btn.dataset.fx === track.currentEffect) btn.classList.add('selected');
    });

    updateXYCursor(track.effectParams.x, track.effectParams.y);
    updateLabels(track.currentEffect);
}

function deselectAll() {
    selectedTrackId = null;
    if(noTrackSelectedMsg) noTrackSelectedMsg.classList.remove('hidden');
    if(fxControls) fxControls.classList.add('hidden');
    document.querySelectorAll('.loop-item').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.select-btn').forEach(b => {
        b.classList.remove('active');
        b.innerText = "EDIT FX";
    });
}

effectButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!selectedTrackId) return;
        const type = e.target.dataset.fx;
        const track = tracks.find(t => t.id === selectedTrackId);
        track.setEffect(type);
        effectButtons.forEach(b => b.classList.remove('selected'));
        e.target.classList.add('selected');
        updateLabels(type);
    });
});

function updateLabels(type) {
    const lx = document.getElementById('labelX');
    const ly = document.getElementById('labelY');
    if(type === 'filter' || type === 'highpass' || type === 'bandpass') { lx.innerText = "X: Cutoff"; ly.innerText = "Y: Res"; }
    else if(type === 'autofilter') { lx.innerText = "X: Rate"; ly.innerText = "Y: Depth"; }
    else if(type === 'phaser') { lx.innerText = "X: Rate"; ly.innerText = "Y: Depth"; }
    else if(type === 'flanger') { lx.innerText = "X: Rate"; ly.innerText = "Y: Feedback"; }
    else if(type === 'chorus') { lx.innerText = "X: Rate"; ly.innerText = "Y: Depth"; }
    else if(type === 'tremolo') { lx.innerText = "X: Rate"; ly.innerText = "Y: Depth"; }
    else if(type === 'vibrato') { lx.innerText = "X: Rate"; ly.innerText = "Y: Depth"; }
    else if(type === 'delay' || type === 'echo' || type === 'pingpong') { lx.innerText = "X: Time"; ly.innerText = "Y: Feedback"; }
    else if(type === 'reverb') { lx.innerText = "X: Size"; ly.innerText = "Y: Mix"; }
    else if(type === 'distortion' || type === 'overdrive' || type === 'saturation') { lx.innerText = "X: Drive"; ly.innerText = "Y: Tone"; }
    else if(type === 'bitcrusher') { lx.innerText = "X: Bits"; ly.innerText = "Y: Rate"; }
    else if(type === 'compressor') { lx.innerText = "X: Thresh"; ly.innerText = "Y: Ratio"; }
    else if(type === 'limiter') { lx.innerText = "X: Thresh"; ly.innerText = "Y: Release"; }
    else if(type === 'widener') { lx.innerText = "X: Width"; ly.innerText = "Y: Mix"; }
    else if(type === 'panner') { lx.innerText = "X: Pan"; ly.innerText = "Y: Level"; }
    else if(type === 'pitch') { lx.innerText = "X: Shift"; ly.innerText = "Y: Mix"; }
    else if(type === 'harmonizer') { lx.innerText = "X: Interval"; ly.innerText = "Y: Mix"; }
    else if(type === 'granular') { lx.innerText = "X: Grain"; ly.innerText = "Y: Spray"; }
    else { lx.innerText = "X: --"; ly.innerText = "Y: --"; }
}

let isDragging = false;
if(xyPad) {
    xyPad.addEventListener('mousedown', (e) => { isDragging = true; handleXY(e); });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('mousemove', (e) => { if(isDragging) handleXY(e); });
}

function handleXY(e) {
    if (!selectedTrackId) return;
    const rect = xyPad.getBoundingClientRect();
    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    let y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    const normX = x / rect.width;
    const normY = 1.0 - (y / rect.height);
    updateXYCursor(normX, normY);
    const track = tracks.find(t => t.id === selectedTrackId);
    if (track) track.updateEffectParams(normX, normY);
}

function updateXYCursor(normX, normY) {
    if(xyCursor) {
        xyCursor.style.left = `${normX * 100}%`;
        xyCursor.style.top = `${(1.0 - normY) * 100}%`;
    }
}

document.getElementById('playAllBtn').addEventListener('click', () => {
    playArrangement();
});
document.getElementById('stopAllBtn').addEventListener('click', () => {
    stopArrangement();
    tracks.forEach(t => {
        t.stop();
        updatePlayButtonUI(t.id, false);
    });
    if (drumRecording) {
        drumRecording = false;
        updateDrumRecordUI();
    }
});

// --- Resampling ---
let isResampling = false;
if (resampleBtn) {
    resampleBtn.addEventListener('click', async () => {
        if (!selectedTrackId) return;
        const ctx = initAudioContext();
        const sourceTrack = tracks.find(t => t.id === selectedTrackId);
        
        if (isResampling) {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            sourceTrack.stop();
            updatePlayButtonUI(sourceTrack.id, false);
            resampleBtn.innerHTML = "⚠ Resample (Record FX)";
            resampleBtn.classList.remove('active');
            recordBtn.disabled = false;
            resampleBtn.style.background = "#d68a28";
            isResampling = false;
        } else {
            recordBtn.disabled = true;
            const dest = ctx.createMediaStreamDestination();
            sourceTrack.gainNode.connect(dest);
            mediaRecorder = new MediaRecorder(dest.stream);
            chunks = [];
            mediaRecorder.ondataavailable = e => chunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunks, { 'type' : 'audio/ogg; codecs=opus' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                createTrack(audioBuffer);
                sourceTrack.gainNode.disconnect(dest);
            };
            mediaRecorder.start();
            // Resample at current global speed
            sourceTrack.play(globalPlaybackRate);
            updatePlayButtonUI(sourceTrack.id, true);
            isResampling = true;
            resampleBtn.innerHTML = "■ STOP RESAMPLE";
            resampleBtn.style.background = "#ff4444";
            resampleBtn.classList.add('active');
        }
    });
}

// --- Timeline / Arrangement ---
function getDefaultClipDuration(track) {
    const rawDur = track.buffer.duration;
    const trimmed = rawDur * (track.trimEnd - track.trimStart);
    const rate = Math.max(0.1, track.localRate);
    return Math.max(MIN_CLIP_DURATION, trimmed / rate);
}

function createClip(trackId, startTime, duration) {
    const step = getGridStepSeconds();
    const snappedStart = snapEnabled ? snapTime(startTime) : startTime;
    let snappedDuration = duration;
    if (snapEnabled && step > 0) {
        snappedDuration = Math.round(duration / step) * step;
    }
    const clip = {
        id: clipIdCounter++,
        trackId,
        start: Math.max(0, snappedStart),
        duration: Math.max(MIN_CLIP_DURATION, snappedDuration)
    };
    clips.push(clip);
    renderTimeline();
}

function getTimelineLength() {
    const maxEnd = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    return Math.max(DEFAULT_TIMELINE_SECONDS, Math.ceil(maxEnd + 5));
}

function renderTimeline() {
    if (!timelineBody || !timelineRuler) return;

    const timelineSeconds = getTimelineLength();
    timelineSecondsState = timelineSeconds;
    const timelineWidth = timelineSeconds * TIMELINE_SCALE;

    timelineRuler.innerHTML = '';
    timelineRuler.style.width = `${timelineWidth}px`;

    const secondsPerBeat = getSecondsPerBeat();
    const totalBeats = Math.ceil(timelineSeconds / secondsPerBeat);

    for (let b = 0; b <= totalBeats; b++) {
        const tick = document.createElement('div');
        const isBar = b % beatsPerBar === 0;
        tick.className = `timeline-tick${isBar ? ' major' : ''}`;
        tick.style.left = `${b * secondsPerBeat * TIMELINE_SCALE}px`;
        timelineRuler.appendChild(tick);
        if (isBar) {
            const label = document.createElement('div');
            label.className = 'timeline-tick-label';
            label.style.left = `${b * secondsPerBeat * TIMELINE_SCALE}px`;
            label.innerText = `${Math.floor(b / beatsPerBar) + 1}`;
            timelineRuler.appendChild(label);
        }
    }

    renderLoopRegion(timelineWidth);

    timelineBody.innerHTML = '';

    const drumRow = document.createElement('div');
    drumRow.className = 'timeline-row drum-row';

    const drumLabel = document.createElement('div');
    drumLabel.className = 'timeline-label';
    drumLabel.innerText = 'DRUMS';

    const drumLane = document.createElement('div');
    drumLane.className = 'timeline-lane drum-lane';
    drumLane.style.width = `${timelineWidth}px`;

    const drumRowHeight = getDrumRowHeight();
    const subRowHeight = drumRowHeight / padBank.length;

    padBank.forEach((_, idx) => {
        const sub = document.createElement('div');
        sub.className = 'drum-subrow';
        sub.dataset.pad = idx;
        sub.style.top = `${idx * subRowHeight}px`;
        drumLane.appendChild(sub);
    });

    drumPattern.events.forEach(ev => {
        const hit = document.createElement('div');
        hit.className = 'drum-hit';
        hit.dataset.pad = ev.padIndex;
        hit.dataset.time = ev.time;
        hit.style.left = `${ev.time * TIMELINE_SCALE}px`;
        hit.style.top = `${ev.padIndex * subRowHeight}px`;
        hit.style.width = `${Math.max(10, getGridStepSeconds() * TIMELINE_SCALE - 2)}px`;
        hit.innerText = PAD_KEYS[ev.padIndex] ? PAD_KEYS[ev.padIndex].toUpperCase() : '';
        hit.addEventListener('click', (e) => {
            e.stopPropagation();
            const padIndex = parseInt(hit.dataset.pad, 10);
            const time = parseFloat(hit.dataset.time);
            const idx = drumPattern.events.findIndex(ev2 => ev2.padIndex === padIndex && Math.abs(ev2.time - time) < 0.0005);
            if (idx !== -1) drumPattern.events.splice(idx, 1);
            renderTimeline();
        });
        drumLane.appendChild(hit);
    });

    drumLane.addEventListener('click', (e) => {
        const rect = drumLane.getBoundingClientRect();
        const scrollLeft = timelineEl ? timelineEl.scrollLeft : 0;
        const x = Math.max(0, e.clientX - rect.left + scrollLeft);
        const y = Math.max(0, e.clientY - rect.top);
        const padIndex = Math.min(padBank.length - 1, Math.max(0, Math.floor(y / subRowHeight)));
        const time = x / TIMELINE_SCALE;
        addDrumHit(padIndex, time, false);
        renderTimeline();
    });

    drumRow.appendChild(drumLabel);
    drumRow.appendChild(drumLane);
    timelineBody.appendChild(drumRow);

    tracks.forEach(track => {
        const row = document.createElement('div');
        row.className = 'timeline-row';

        const label = document.createElement('div');
        label.className = 'timeline-label';
        label.innerText = track.name;

        const lane = document.createElement('div');
        lane.className = 'timeline-lane';
        lane.dataset.trackId = track.id;
        lane.style.width = `${timelineWidth}px`;

        lane.addEventListener('dblclick', (e) => {
            const rect = lane.getBoundingClientRect();
            const scrollLeft = timelineEl ? timelineEl.scrollLeft : 0;
            const x = Math.max(0, e.clientX - rect.left + scrollLeft);
            const start = x / TIMELINE_SCALE;
            createClip(track.id, start, getDefaultClipDuration(track));
        });

        clips.filter(c => c.trackId === track.id).forEach(clip => {
            const clipEl = document.createElement('div');
            clipEl.className = 'timeline-clip';
            clipEl.dataset.clipId = clip.id;
            clipEl.style.left = `${clip.start * TIMELINE_SCALE}px`;
            clipEl.style.width = `${clip.duration * TIMELINE_SCALE}px`;
            clipEl.innerText = track.name;

            const handleL = document.createElement('div');
            handleL.className = 'clip-handle left';
            const handleR = document.createElement('div');
            handleR.className = 'clip-handle right';
            clipEl.appendChild(handleL);
            clipEl.appendChild(handleR);

            clipEl.addEventListener('mousedown', (e) => startClipDrag(e, clip.id, 'move'));
            clipEl.addEventListener('dblclick', (e) => e.stopPropagation());
            handleL.addEventListener('mousedown', (e) => startClipDrag(e, clip.id, 'resize-left'));
            handleR.addEventListener('mousedown', (e) => startClipDrag(e, clip.id, 'resize-right'));

            lane.appendChild(clipEl);
        });

        row.appendChild(label);
        row.appendChild(lane);
        timelineBody.appendChild(row);
    });
}

function renderLoopRegion(timelineWidth) {
    if (!timelineRuler) return;
    if (loopRegion.end - loopRegion.start < MIN_CLIP_DURATION) {
        loopRegion.end = loopRegion.start + 1;
    }
    loopRegion.start = Math.max(0, Math.min(loopRegion.start, timelineSecondsState - MIN_CLIP_DURATION));
    loopRegion.end = Math.max(loopRegion.start + MIN_CLIP_DURATION, Math.min(loopRegion.end, timelineSecondsState));

    const region = document.createElement('div');
    region.className = 'timeline-loop-region';
    region.style.left = `${loopRegion.start * TIMELINE_SCALE}px`;
    region.style.width = `${(loopRegion.end - loopRegion.start) * TIMELINE_SCALE}px`;
    region.innerText = loopEnabled ? "LOOP" : "REGION";

    const handleL = document.createElement('div');
    handleL.className = 'loop-handle left';
    const handleR = document.createElement('div');
    handleR.className = 'loop-handle right';
    region.appendChild(handleL);
    region.appendChild(handleR);

    region.addEventListener('mousedown', (e) => startLoopDrag(e, 'move'));
    handleL.addEventListener('mousedown', (e) => startLoopDrag(e, 'resize-left'));
    handleR.addEventListener('mousedown', (e) => startLoopDrag(e, 'resize-right'));
    region.addEventListener('dblclick', (e) => e.stopPropagation());

    timelineRuler.appendChild(region);

    if (timelineLoopOverlay) {
        timelineLoopOverlay.style.left = `${loopRegion.start * TIMELINE_SCALE}px`;
        timelineLoopOverlay.style.width = `${(loopRegion.end - loopRegion.start) * TIMELINE_SCALE}px`;
        const rowHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--timeline-row-height')) || 56;
        const drumHeight = getDrumRowHeight();
        timelineLoopOverlay.style.height = `${drumHeight + (tracks.length * rowHeight)}px`;
    }
}

let dragState = null;
let loopDragState = null;

function startClipDrag(e, clipId, mode) {
    e.stopPropagation();
    e.preventDefault();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    dragState = {
        clipId,
        mode,
        startX: e.clientX,
        origStart: clip.start,
        origDuration: clip.duration
    };
}

window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const clip = clips.find(c => c.id === dragState.clipId);
    if (!clip) return;

    const dx = (e.clientX - dragState.startX) / TIMELINE_SCALE;
    const snap = isSnapActive(e);

    if (dragState.mode === 'move') {
        const rawStart = dragState.origStart + dx;
        const nextStart = snap ? snapTime(rawStart) : rawStart;
        clip.start = Math.max(0, nextStart);
    } else if (dragState.mode === 'resize-left') {
        const end = dragState.origStart + dragState.origDuration;
        let newStart = dragState.origStart + dx;
        if (snap) newStart = snapTime(newStart);
        newStart = Math.max(0, Math.min(newStart, end - MIN_CLIP_DURATION));
        clip.start = newStart;
        clip.duration = Math.max(MIN_CLIP_DURATION, end - newStart);
    } else if (dragState.mode === 'resize-right') {
        let end = dragState.origStart + dragState.origDuration + dx;
        if (snap) end = snapTime(end);
        clip.duration = Math.max(MIN_CLIP_DURATION, end - dragState.origStart);
    }

    const clipEl = document.querySelector(`.timeline-clip[data-clip-id="${clip.id}"]`);
    if (clipEl) {
        clipEl.style.left = `${clip.start * TIMELINE_SCALE}px`;
        clipEl.style.width = `${clip.duration * TIMELINE_SCALE}px`;
    }
});

window.addEventListener('mouseup', () => {
    if (dragState) {
        dragState = null;
        renderTimeline();
    }
});

function startLoopDrag(e, mode) {
    e.stopPropagation();
    e.preventDefault();
    loopDragState = {
        mode,
        startX: e.clientX,
        origStart: loopRegion.start,
        origEnd: loopRegion.end
    };
}

window.addEventListener('mousemove', (e) => {
    if (!loopDragState) return;
    const dx = (e.clientX - loopDragState.startX) / TIMELINE_SCALE;
    const snap = isSnapActive(e);

    if (loopDragState.mode === 'move') {
        const length = loopDragState.origEnd - loopDragState.origStart;
        let newStart = loopDragState.origStart + dx;
        if (snap) newStart = snapTime(newStart);
        newStart = Math.max(0, Math.min(newStart, timelineSecondsState - length));
        loopRegion.start = newStart;
        loopRegion.end = newStart + length;
    } else if (loopDragState.mode === 'resize-left') {
        let newStart = loopDragState.origStart + dx;
        if (snap) newStart = snapTime(newStart);
        newStart = Math.max(0, Math.min(newStart, loopRegion.end - MIN_CLIP_DURATION));
        loopRegion.start = newStart;
    } else if (loopDragState.mode === 'resize-right') {
        let newEnd = loopDragState.origEnd + dx;
        if (snap) newEnd = snapTime(newEnd);
        newEnd = Math.max(loopRegion.start + MIN_CLIP_DURATION, Math.min(newEnd, timelineSecondsState));
        loopRegion.end = newEnd;
    }

    updateLoopRegionUI();
});

window.addEventListener('mouseup', () => {
    if (loopDragState) {
        loopDragState = null;
        renderTimeline();
        if (arrangementPlaying && loopEnabled) {
            playArrangement();
        }
    }
});

function updateLoopRegionUI() {
    const region = document.querySelector('.timeline-loop-region');
    if (region) {
        region.style.left = `${loopRegion.start * TIMELINE_SCALE}px`;
        region.style.width = `${(loopRegion.end - loopRegion.start) * TIMELINE_SCALE}px`;
        region.innerText = loopEnabled ? "LOOP" : "REGION";
    }
    if (timelineLoopOverlay) {
        timelineLoopOverlay.style.left = `${loopRegion.start * TIMELINE_SCALE}px`;
        timelineLoopOverlay.style.width = `${(loopRegion.end - loopRegion.start) * TIMELINE_SCALE}px`;
        const rowHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--timeline-row-height')) || 56;
        const drumHeight = getDrumRowHeight();
        timelineLoopOverlay.style.height = `${drumHeight + (tracks.length * rowHeight)}px`;
    }
}

function playArrangement() {
    const ctx = initAudioContext();
    stopArrangement();
    if (clips.length === 0) return;
    tracks.forEach(t => {
        t.stop();
        updatePlayButtonUI(t.id, false);
    });

    arrangementSources = [];
    arrangementPlaying = true;
    const now = ctx.currentTime + 0.05;
    arrangementStartTime = loopEnabled ? now - loopRegion.start : now;

    if (loopEnabled) {
        const loopLength = Math.max(MIN_CLIP_DURATION, loopRegion.end - loopRegion.start);
        let nextCycleTime = now;

        const scheduleCycle = () => {
            if (!arrangementPlaying || !loopEnabled) return;
            scheduleArrangementCycle(nextCycleTime, loopRegion.start, loopRegion.end);
            nextCycleTime += loopLength;
            const waitMs = Math.max(20, (nextCycleTime - ctx.currentTime - 0.1) * 1000);
            loopTimer = window.setTimeout(scheduleCycle, waitMs);
        };

        scheduleCycle();
    } else {
        scheduleArrangementCycle(now, 0, Number.POSITIVE_INFINITY);
    }
}

function stopArrangement() {
    arrangementSources.forEach(source => {
        try { source.stop(); } catch (e) {}
        try { source.disconnect(); } catch (e) {}
    });
    arrangementSources = [];
    arrangementPlaying = false;
    if (loopTimer) {
        window.clearTimeout(loopTimer);
        loopTimer = null;
    }
}

function scheduleArrangementCycle(startAt, windowStart, windowEnd) {
    const ctx = initAudioContext();
    scheduleDrumPattern(startAt, windowStart, windowEnd);
    clips.forEach(clip => {
        const clipStart = clip.start;
        const clipEnd = clip.start + clip.duration;
        const overlapStart = Math.max(clipStart, windowStart);
        const overlapEnd = Math.min(clipEnd, windowEnd);
        if (overlapEnd <= overlapStart) return;

        const track = tracks.find(t => t.id === clip.trackId);
        if (!track) return;

        const source = ctx.createBufferSource();
        source.buffer = track.buffer;
        source.loop = true;

        const duration = track.buffer.duration;
        source.loopStart = duration * track.trimStart;
        source.loopEnd = duration * track.trimEnd;
        if (source.loopEnd - source.loopStart < 0.01) {
            source.loop = false;
        }

        const finalRate = track.localRate * globalPlaybackRate;
        const rate = Math.max(0.1, Math.min(finalRate, 4.0));
        source.playbackRate.value = rate;

        const overlapOffset = overlapStart - clipStart;
        const offsetInBuffer = source.loopStart + overlapOffset * rate;
        const segmentStart = startAt + (overlapStart - windowStart);
        const segmentEnd = startAt + (overlapEnd - windowStart);

        source.connect(track.fxInput);
        source.start(segmentStart, offsetInBuffer);
        source.stop(segmentEnd);
        arrangementSources.push(source);
    });
}

function scheduleDrumPattern(startAt, windowStart, windowEnd) {
    if (!drumPattern.events.length) return;
    const ctx = initAudioContext();
    const baseTime = startAt - windowStart;
    const baseStart = loopEnabled ? loopRegion.start : 0;
    const baseLength = loopEnabled ? (loopRegion.end - loopRegion.start) : (drumPattern.length || (beatsPerBar * getSecondsPerBeat()));
    const loopLength = Math.max(MIN_CLIP_DURATION, baseLength);
    drumPattern.events.forEach(ev => {
        if (!padBank[ev.padIndex] || !padBank[ev.padIndex].buffer) return;
        let timelineTime = baseStart + ev.time;
        if (loopEnabled) {
            timelineTime = baseStart + (ev.time % loopLength);
        }
        if (timelineTime < windowStart || timelineTime >= windowEnd) return;
        const when = baseTime + timelineTime;
        if (when < ctx.currentTime) return;
        const source = ctx.createBufferSource();
        source.buffer = padBank[ev.padIndex].buffer;
        source.connect(ctx.destination);
        source.start(when);
        arrangementSources.push(source);
    });
}


// --- EXPORT LOGIC ---
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
        if (tracks.length === 0) return alert("No tracks to export.");
        
        const oldText = exportBtn.innerText;
        exportBtn.innerText = "Rendering...";
        exportBtn.disabled = true;

        try {
            // 1. Calculate Length
            let maxDuration = 0;
            tracks.forEach(t => {
                const rawDur = t.buffer.duration;
                const trimLen = rawDur * (t.trimEnd - t.trimStart);
                const finalDur = trimLen / (t.localRate * globalPlaybackRate);
                if (finalDur > maxDuration) maxDuration = finalDur;
            });
            
            // Render 4 loops worth (or minimum 10 seconds)
            const renderDuration = Math.max(maxDuration * 4, 10.0); 

            // 2. Setup Offline Context
            const offlineCtx = new OfflineAudioContext(
                2, 
                Math.ceil(renderDuration * 44100), 
                44100
            );

            // 3. Clone Tracks
            tracks.forEach(t => {
                // Create Ghost
                const ghost = new Track(t.id, t.buffer, "Ghost");
                
                // FORCE initialize on Offline Context
                // This will create new Filter/Delay/Gain nodes on the offline graph
                ghost.initAudioGraph(offlineCtx); 
                
                // Copy State
                ghost.currentEffect = t.currentEffect;
                ghost.effectParams = t.effectParams;
                ghost.trimStart = t.trimStart;
                ghost.trimEnd = t.trimEnd;
                ghost.localRate = t.localRate;

                // Wire up Effects
                ghost.refreshEffectRouting();
                
                // Apply Params (Crucial: The Track.js update will now use setValueAtTime because t=0)
                ghost.updateEffectParams(t.effectParams.x, t.effectParams.y);

                // Connect to Offline Master
                ghost.gainNode.connect(offlineCtx.destination);

                // Setup Source
                const source = offlineCtx.createBufferSource();
                source.buffer = t.buffer;
                source.loop = true;
                
                const duration = t.buffer.duration;
                source.loopStart = duration * t.trimStart;
                source.loopEnd = duration * t.trimEnd;
                
                // Prevent glitching if trim is near zero
                if (source.loopEnd - source.loopStart < 0.01) source.loop = false;

                const finalRate = t.localRate * globalPlaybackRate;
                source.playbackRate.value = finalRate;

                // Connect to the Ghost's FX Chain
                source.connect(ghost.fxInput);
                
                // Start
                source.start(0, source.loopStart);
            });

            // 4. Render
            const renderedBuffer = await offlineCtx.startRendering();

            // 5. Save
            const blob = bufferToWav(renderedBuffer, renderedBuffer.length);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `LoopStation_Mix_${Date.now()}.wav`;
            document.body.appendChild(a);
            a.click();
            a.remove();

        } catch (err) {
            console.error(err);
            alert("Export failed: " + err.message);
        }

        exportBtn.innerText = oldText;
        exportBtn.disabled = false;
    });
}

renderTimeline();
