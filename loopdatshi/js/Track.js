import { getAudioContext } from './AudioEngine.js';

export class Track {
    constructor(id, buffer, name) {
        this.id = id;
        this.buffer = buffer;
        this.name = name;

        // Audio State
        this.isPlaying = false;
        this.trimStart = 0;
        this.trimEnd = 1;
        this.localRate = 1.0;

        // Effect State
        this.currentEffect = 'bypass';
        this.effectParams = { x: 0.5, y: 0.5 };

        // Nodes
        this.sourceNode = null;
        this.gainNode = null;
        this.fxInput = null;
        this.fxOutput = null;

        // Effect Nodes
        this.filterNode = null;
        this.highpassNode = null;
        this.bandpassNode = null;
        this.autoFilterNode = null;
        this.autoFilterLfo = null;
        this.autoFilterLfoGain = null;

        this.phaserFilters = [];
        this.phaserLfo = null;
        this.phaserLfoGain = null;
        this.phaserMix = null;

        this.flangerDelay = null;
        this.flangerFeedback = null;
        this.flangerMix = null;
        this.flangerLfo = null;
        this.flangerLfoGain = null;

        this.chorusDelayL = null;
        this.chorusDelayR = null;
        this.chorusMix = null;
        this.chorusLfoL = null;
        this.chorusLfoR = null;
        this.chorusLfoGainL = null;
        this.chorusLfoGainR = null;

        this.tremoloGain = null;
        this.tremoloLfo = null;
        this.tremoloLfoGain = null;

        this.vibratoDelay = null;
        this.vibratoMix = null;
        this.vibratoLfo = null;
        this.vibratoLfoGain = null;

        this.delayNode = null;
        this.delayFeedback = null;
        this.delayMix = null;

        this.echoDelay = null;
        this.echoFeedback = null;
        this.echoLowpass = null;
        this.echoMix = null;

        this.pingpongSplit = null;
        this.pingpongMerge = null;
        this.pingpongDelayL = null;
        this.pingpongDelayR = null;
        this.pingpongFeedback = null;
        this.pingpongMix = null;

        this.reverbNode = null;
        this.reverbMix = null;
        this.reverbSeconds = 2;
        this.reverbDecay = 2;

        this.distNode = null;
        this.distTone = null;
        this.overdriveNode = null;
        this.overdriveTone = null;
        this.saturationNode = null;
        this.saturationTone = null;
        this.bitcrusherNode = null;

        this.compressorNode = null;
        this.limiterNode = null;

        this.widenerSplit = null;
        this.widenerDelay = null;
        this.widenerMerge = null;
        this.widenerDryGain = null;
        this.widenerWetGain = null;

        this.pannerNode = null;
        this.pannerGain = null;

        this.pitchNode = null;
        this.pitchDryGain = null;
        this.pitchWetGain = null;
        this.harmonizerNode = null;
        this.harmonizerDryGain = null;
        this.harmonizerWetGain = null;
        this.granularNode = null;
        this.granularDryGain = null;
        this.granularWetGain = null;

        // Initialize on the default Global Context
        this.initAudioGraph();
    }

    // Accept an optional context (for exporting)
    initAudioGraph(customCtx = null) {
        const ctx = customCtx || getAudioContext();

        // 1. Output Gain
        this.gainNode = ctx.createGain();
        // Only connect to speakers if this is the REAL context
        if (!customCtx) {
            this.gainNode.connect(ctx.destination);
        }

        // 2. FX Chain Routing
        this.fxInput = ctx.createGain();
        this.fxOutput = ctx.createGain();
        this.fxOutput.connect(this.gainNode);

        // 3. Create Effect Nodes on the specific context

        // Filters
        this.filterNode = ctx.createBiquadFilter();
        this.filterNode.type = "lowpass";
        this.filterNode.frequency.value = 20000;

        this.highpassNode = ctx.createBiquadFilter();
        this.highpassNode.type = "highpass";
        this.highpassNode.frequency.value = 20;

        this.bandpassNode = ctx.createBiquadFilter();
        this.bandpassNode.type = "bandpass";
        this.bandpassNode.frequency.value = 800;

        // Auto-filter
        this.autoFilterNode = ctx.createBiquadFilter();
        this.autoFilterNode.type = "lowpass";
        this.autoFilterNode.frequency.value = 600;
        this.autoFilterLfo = ctx.createOscillator();
        this.autoFilterLfo.type = "sine";
        this.autoFilterLfoGain = ctx.createGain();
        this.autoFilterLfo.connect(this.autoFilterLfoGain);
        this.autoFilterLfoGain.connect(this.autoFilterNode.frequency);
        this.autoFilterLfo.start();

        // Phaser
        this.phaserFilters = Array.from({ length: 4 }, () => {
            const filter = ctx.createBiquadFilter();
            filter.type = "allpass";
            filter.frequency.value = 800;
            return filter;
        });
        this.phaserLfo = ctx.createOscillator();
        this.phaserLfo.type = "sine";
        this.phaserLfoGain = ctx.createGain();
        this.phaserLfo.connect(this.phaserLfoGain);
        this.phaserFilters.forEach(filter => this.phaserLfoGain.connect(filter.frequency));
        this.phaserLfo.start();
        this.phaserMix = ctx.createGain();

        // Flanger
        this.flangerDelay = ctx.createDelay(0.05);
        this.flangerFeedback = ctx.createGain();
        this.flangerMix = ctx.createGain();
        this.flangerLfo = ctx.createOscillator();
        this.flangerLfo.type = "sine";
        this.flangerLfoGain = ctx.createGain();
        this.flangerLfo.connect(this.flangerLfoGain);
        this.flangerLfoGain.connect(this.flangerDelay.delayTime);
        this.flangerLfo.start();

        // Chorus
        this.chorusDelayL = ctx.createDelay(0.05);
        this.chorusDelayR = ctx.createDelay(0.05);
        this.chorusMix = ctx.createGain();
        this.chorusLfoL = ctx.createOscillator();
        this.chorusLfoR = ctx.createOscillator();
        this.chorusLfoGainL = ctx.createGain();
        this.chorusLfoGainR = ctx.createGain();
        this.chorusLfoL.connect(this.chorusLfoGainL);
        this.chorusLfoGainL.connect(this.chorusDelayL.delayTime);
        this.chorusLfoR.connect(this.chorusLfoGainR);
        this.chorusLfoGainR.connect(this.chorusDelayR.delayTime);
        this.chorusLfoL.start();
        this.chorusLfoR.start();

        // Tremolo
        this.tremoloGain = ctx.createGain();
        this.tremoloLfo = ctx.createOscillator();
        this.tremoloLfo.type = "sine";
        this.tremoloLfoGain = ctx.createGain();
        this.tremoloLfo.connect(this.tremoloLfoGain);
        this.tremoloLfoGain.connect(this.tremoloGain.gain);
        this.tremoloLfo.start();

        // Vibrato
        this.vibratoDelay = ctx.createDelay(0.05);
        this.vibratoMix = ctx.createGain();
        this.vibratoLfo = ctx.createOscillator();
        this.vibratoLfo.type = "sine";
        this.vibratoLfoGain = ctx.createGain();
        this.vibratoLfo.connect(this.vibratoLfoGain);
        this.vibratoLfoGain.connect(this.vibratoDelay.delayTime);
        this.vibratoLfo.start();

        // Delay
        this.delayNode = ctx.createDelay(2.5);
        this.delayFeedback = ctx.createGain();
        this.delayMix = ctx.createGain();

        // Echo
        this.echoDelay = ctx.createDelay(1.2);
        this.echoFeedback = ctx.createGain();
        this.echoLowpass = ctx.createBiquadFilter();
        this.echoLowpass.type = "lowpass";
        this.echoLowpass.frequency.value = 3000;
        this.echoMix = ctx.createGain();

        // Ping-pong delay
        this.pingpongSplit = ctx.createChannelSplitter(2);
        this.pingpongMerge = ctx.createChannelMerger(2);
        this.pingpongDelayL = ctx.createDelay(2.0);
        this.pingpongDelayR = ctx.createDelay(2.0);
        this.pingpongFeedback = ctx.createGain();
        this.pingpongMix = ctx.createGain();

        // Reverb
        this.reverbNode = ctx.createConvolver();
        this.reverbMix = ctx.createGain();
        this.reverbNode.buffer = this.createImpulseResponse(ctx, this.reverbSeconds, this.reverbDecay);

        // Distortion family
        this.distNode = ctx.createWaveShaper();
        this.distNode.curve = this.makeDistortionCurve(0);
        this.distNode.oversample = '4x';
        this.distTone = ctx.createBiquadFilter();
        this.distTone.type = "lowpass";
        this.distTone.frequency.value = 16000;

        this.overdriveNode = ctx.createWaveShaper();
        this.overdriveNode.curve = this.makeOverdriveCurve(0.2);
        this.overdriveNode.oversample = '4x';
        this.overdriveTone = ctx.createBiquadFilter();
        this.overdriveTone.type = "lowpass";
        this.overdriveTone.frequency.value = 14000;

        this.saturationNode = ctx.createWaveShaper();
        this.saturationNode.curve = this.makeSaturationCurve(0.2);
        this.saturationNode.oversample = '4x';
        this.saturationTone = ctx.createBiquadFilter();
        this.saturationTone.type = "lowpass";
        this.saturationTone.frequency.value = 15000;

        this.bitcrusherNode = this.createBitcrusher(ctx);

        // Dynamics
        this.compressorNode = ctx.createDynamicsCompressor();
        this.limiterNode = ctx.createDynamicsCompressor();

        // Stereo widener
        this.widenerSplit = ctx.createChannelSplitter(2);
        this.widenerDelay = ctx.createDelay(0.03);
        this.widenerMerge = ctx.createChannelMerger(2);
        this.widenerDryGain = ctx.createGain();
        this.widenerWetGain = ctx.createGain();

        // Panner
        this.pannerNode = ctx.createStereoPanner();
        this.pannerGain = ctx.createGain();

        // Pitch / Harmonizer / Granular
        this.pitchNode = this.createPitchShifter(ctx);
        this.pitchDryGain = ctx.createGain();
        this.pitchWetGain = ctx.createGain();
        this.harmonizerNode = this.createPitchShifter(ctx);
        this.harmonizerDryGain = ctx.createGain();
        this.harmonizerWetGain = ctx.createGain();
        this.granularNode = this.createGranularProcessor(ctx);
        this.granularDryGain = ctx.createGain();
        this.granularWetGain = ctx.createGain();

        // Apply Routing
        this.refreshEffectRouting();
    }

    makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    makeOverdriveCurve(amount) {
        const k = Math.max(0.1, amount * 30);
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
        }
        return curve;
    }

    makeSaturationCurve(amount) {
        const k = 1 + amount * 8;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            curve[i] = Math.tanh(k * x);
        }
        return curve;
    }

    createImpulseResponse(ctx, seconds, decay) {
        const rate = ctx.sampleRate;
        const length = Math.max(1, Math.floor(rate * seconds));
        const impulse = ctx.createBuffer(2, length, rate);
        for (let channel = 0; channel < 2; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const t = i / length;
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
            }
        }
        return impulse;
    }

    createBitcrusher(ctx) {
        const node = ctx.createScriptProcessor(2048, 2, 2);
        node.bits = 8;
        node.normFreq = 0.5;
        let phaser = 0;
        let lastL = 0;
        let lastR = 0;
        node.onaudioprocess = (e) => {
            const inputL = e.inputBuffer.getChannelData(0);
            const inputR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inputL;
            const outputL = e.outputBuffer.getChannelData(0);
            const outputR = e.outputBuffer.getChannelData(1);
            const step = Math.pow(0.5, node.bits);
            for (let i = 0; i < inputL.length; i++) {
                phaser += node.normFreq;
                if (phaser >= 1.0) {
                    phaser -= 1.0;
                    lastL = step * Math.floor(inputL[i] / step + 0.5);
                    lastR = step * Math.floor(inputR[i] / step + 0.5);
                }
                outputL[i] = lastL;
                outputR[i] = lastR;
            }
        };
        return node;
    }

    createPitchShifter(ctx) {
        const node = ctx.createScriptProcessor(1024, 2, 2);
        const ringSize = 4096;
        const bufferL = new Float32Array(ringSize);
        const bufferR = new Float32Array(ringSize);
        let writeIndex = 0;
        let readIndex = 0;
        node.pitchRatio = 1.0;

        const readSample = (buffer, index) => {
            const i0 = Math.floor(index);
            const i1 = (i0 + 1) % ringSize;
            const frac = index - i0;
            return buffer[i0] + (buffer[i1] - buffer[i0]) * frac;
        };

        node.onaudioprocess = (e) => {
            const inputL = e.inputBuffer.getChannelData(0);
            const inputR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inputL;
            const outputL = e.outputBuffer.getChannelData(0);
            const outputR = e.outputBuffer.getChannelData(1);
            const ratio = Math.max(0.5, Math.min(node.pitchRatio, 2.0));

            for (let i = 0; i < inputL.length; i++) {
                bufferL[writeIndex] = inputL[i];
                bufferR[writeIndex] = inputR[i];
                writeIndex = (writeIndex + 1) % ringSize;

                readIndex = (readIndex + ratio) % ringSize;
                const readIndex2 = (readIndex + ringSize / 2) % ringSize;
                let fade = (readIndex / ringSize) * 2;
                if (fade > 1) fade = 2 - fade;

                const sampleL = readSample(bufferL, readIndex) * fade +
                    readSample(bufferL, readIndex2) * (1 - fade);
                const sampleR = readSample(bufferR, readIndex) * fade +
                    readSample(bufferR, readIndex2) * (1 - fade);

                outputL[i] = sampleL;
                outputR[i] = sampleR;
            }
        };
        return node;
    }

    createGranularProcessor(ctx) {
        const node = ctx.createScriptProcessor(1024, 2, 2);
        const ringSize = 8192;
        const bufferL = new Float32Array(ringSize);
        const bufferR = new Float32Array(ringSize);
        let writeIndex = 0;
        let readIndex = 0;
        let grainPos = 0;
        node.grainSize = 2048;
        node.spray = 0.3;

        node.onaudioprocess = (e) => {
            const inputL = e.inputBuffer.getChannelData(0);
            const inputR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inputL;
            const outputL = e.outputBuffer.getChannelData(0);
            const outputR = e.outputBuffer.getChannelData(1);

            for (let i = 0; i < inputL.length; i++) {
                bufferL[writeIndex] = inputL[i];
                bufferR[writeIndex] = inputR[i];
                writeIndex = (writeIndex + 1) % ringSize;

                if (grainPos === 0) {
                    const maxOffset = Math.floor(node.spray * ringSize * 0.5);
                    const randOffset = Math.floor(Math.random() * Math.max(1, maxOffset));
                    readIndex = (writeIndex - randOffset + ringSize) % ringSize;
                }

                outputL[i] = bufferL[readIndex];
                outputR[i] = bufferR[readIndex];
                readIndex = (readIndex + 1) % ringSize;

                grainPos = (grainPos + 1) % node.grainSize;
            }
        };
        return node;
    }

    // Helper to wire up nodes based on currentEffect
    refreshEffectRouting() {
        if (!this.fxInput) return;

        const disconnectNode = (node) => {
            if (!node) return;
            try { node.disconnect(); } catch (e) {}
        };

        // Disconnect everything
        disconnectNode(this.fxInput);
        disconnectNode(this.filterNode);
        disconnectNode(this.highpassNode);
        disconnectNode(this.bandpassNode);
        disconnectNode(this.autoFilterNode);
        this.phaserFilters.forEach(disconnectNode);
        disconnectNode(this.phaserMix);
        disconnectNode(this.flangerDelay);
        disconnectNode(this.flangerFeedback);
        disconnectNode(this.flangerMix);
        disconnectNode(this.chorusDelayL);
        disconnectNode(this.chorusDelayR);
        disconnectNode(this.chorusMix);
        disconnectNode(this.tremoloGain);
        disconnectNode(this.vibratoDelay);
        disconnectNode(this.vibratoMix);
        disconnectNode(this.delayNode);
        disconnectNode(this.delayFeedback);
        disconnectNode(this.delayMix);
        disconnectNode(this.echoDelay);
        disconnectNode(this.echoFeedback);
        disconnectNode(this.echoLowpass);
        disconnectNode(this.echoMix);
        disconnectNode(this.pingpongSplit);
        disconnectNode(this.pingpongDelayL);
        disconnectNode(this.pingpongDelayR);
        disconnectNode(this.pingpongFeedback);
        disconnectNode(this.pingpongMerge);
        disconnectNode(this.pingpongMix);
        disconnectNode(this.reverbNode);
        disconnectNode(this.reverbMix);
        disconnectNode(this.distNode);
        disconnectNode(this.distTone);
        disconnectNode(this.overdriveNode);
        disconnectNode(this.overdriveTone);
        disconnectNode(this.saturationNode);
        disconnectNode(this.saturationTone);
        disconnectNode(this.bitcrusherNode);
        disconnectNode(this.compressorNode);
        disconnectNode(this.limiterNode);
        disconnectNode(this.widenerSplit);
        disconnectNode(this.widenerDelay);
        disconnectNode(this.widenerMerge);
        disconnectNode(this.widenerDryGain);
        disconnectNode(this.widenerWetGain);
        disconnectNode(this.pannerNode);
        disconnectNode(this.pannerGain);
        disconnectNode(this.pitchNode);
        disconnectNode(this.pitchDryGain);
        disconnectNode(this.pitchWetGain);
        disconnectNode(this.harmonizerNode);
        disconnectNode(this.harmonizerDryGain);
        disconnectNode(this.harmonizerWetGain);
        disconnectNode(this.granularNode);
        disconnectNode(this.granularDryGain);
        disconnectNode(this.granularWetGain);

        // Reconnect based on type
        switch (this.currentEffect) {
            case 'filter':
                this.fxInput.connect(this.filterNode);
                this.filterNode.connect(this.fxOutput);
                break;
            case 'highpass':
                this.fxInput.connect(this.highpassNode);
                this.highpassNode.connect(this.fxOutput);
                break;
            case 'bandpass':
                this.fxInput.connect(this.bandpassNode);
                this.bandpassNode.connect(this.fxOutput);
                break;
            case 'autofilter':
                this.fxInput.connect(this.autoFilterNode);
                this.autoFilterNode.connect(this.fxOutput);
                break;
            case 'phaser':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.phaserFilters[0]);
                this.phaserFilters.reduce((prev, curr) => {
                    prev.connect(curr);
                    return curr;
                });
                this.phaserFilters[this.phaserFilters.length - 1].connect(this.phaserMix);
                this.phaserMix.connect(this.fxOutput);
                break;
            case 'flanger':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.flangerDelay);
                this.flangerDelay.connect(this.flangerMix);
                this.flangerMix.connect(this.fxOutput);
                this.flangerDelay.connect(this.flangerFeedback);
                this.flangerFeedback.connect(this.flangerDelay);
                break;
            case 'chorus':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.chorusDelayL);
                this.fxInput.connect(this.chorusDelayR);
                this.chorusDelayL.connect(this.chorusMix);
                this.chorusDelayR.connect(this.chorusMix);
                this.chorusMix.connect(this.fxOutput);
                break;
            case 'tremolo':
                this.fxInput.connect(this.tremoloGain);
                this.tremoloGain.connect(this.fxOutput);
                break;
            case 'vibrato':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.vibratoDelay);
                this.vibratoDelay.connect(this.vibratoMix);
                this.vibratoMix.connect(this.fxOutput);
                break;
            case 'delay':
                this.fxInput.connect(this.fxOutput); // Dry signal
                this.fxInput.connect(this.delayNode); // Wet signal path
                this.delayNode.connect(this.delayMix);
                this.delayMix.connect(this.fxOutput);
                this.delayNode.connect(this.delayFeedback);
                this.delayFeedback.connect(this.delayNode);
                break;
            case 'echo':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.echoDelay);
                this.echoDelay.connect(this.echoLowpass);
                this.echoLowpass.connect(this.echoMix);
                this.echoMix.connect(this.fxOutput);
                this.echoLowpass.connect(this.echoFeedback);
                this.echoFeedback.connect(this.echoDelay);
                break;
            case 'pingpong':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.pingpongSplit);
                this.pingpongSplit.connect(this.pingpongDelayL, 0);
                this.pingpongSplit.connect(this.pingpongDelayR, 1);
                this.pingpongDelayL.connect(this.pingpongMerge, 0, 0);
                this.pingpongDelayR.connect(this.pingpongMerge, 0, 1);
                this.pingpongMerge.connect(this.pingpongMix);
                this.pingpongMix.connect(this.fxOutput);
                this.pingpongDelayL.connect(this.pingpongFeedback);
                this.pingpongDelayR.connect(this.pingpongFeedback);
                this.pingpongFeedback.connect(this.pingpongDelayL);
                this.pingpongFeedback.connect(this.pingpongDelayR);
                break;
            case 'reverb':
                this.fxInput.connect(this.fxOutput);
                this.fxInput.connect(this.reverbNode);
                this.reverbNode.connect(this.reverbMix);
                this.reverbMix.connect(this.fxOutput);
                break;
            case 'distortion':
                this.fxInput.connect(this.distNode);
                this.distNode.connect(this.distTone);
                this.distTone.connect(this.fxOutput);
                break;
            case 'overdrive':
                this.fxInput.connect(this.overdriveNode);
                this.overdriveNode.connect(this.overdriveTone);
                this.overdriveTone.connect(this.fxOutput);
                break;
            case 'saturation':
                this.fxInput.connect(this.saturationNode);
                this.saturationNode.connect(this.saturationTone);
                this.saturationTone.connect(this.fxOutput);
                break;
            case 'bitcrusher':
                this.fxInput.connect(this.bitcrusherNode);
                this.bitcrusherNode.connect(this.fxOutput);
                break;
            case 'compressor':
                this.fxInput.connect(this.compressorNode);
                this.compressorNode.connect(this.fxOutput);
                break;
            case 'limiter':
                this.fxInput.connect(this.limiterNode);
                this.limiterNode.connect(this.fxOutput);
                break;
            case 'widener':
                this.fxInput.connect(this.widenerDryGain);
                this.widenerDryGain.connect(this.fxOutput);
                this.fxInput.connect(this.widenerSplit);
                this.widenerSplit.connect(this.widenerMerge, 0, 0);
                this.widenerSplit.connect(this.widenerDelay, 1);
                this.widenerDelay.connect(this.widenerMerge, 0, 1);
                this.widenerMerge.connect(this.widenerWetGain);
                this.widenerWetGain.connect(this.fxOutput);
                break;
            case 'panner':
                this.fxInput.connect(this.pannerNode);
                this.pannerNode.connect(this.pannerGain);
                this.pannerGain.connect(this.fxOutput);
                break;
            case 'pitch':
                this.fxInput.connect(this.pitchDryGain);
                this.pitchDryGain.connect(this.fxOutput);
                this.fxInput.connect(this.pitchNode);
                this.pitchNode.connect(this.pitchWetGain);
                this.pitchWetGain.connect(this.fxOutput);
                break;
            case 'harmonizer':
                this.fxInput.connect(this.harmonizerDryGain);
                this.harmonizerDryGain.connect(this.fxOutput);
                this.fxInput.connect(this.harmonizerNode);
                this.harmonizerNode.connect(this.harmonizerWetGain);
                this.harmonizerWetGain.connect(this.fxOutput);
                break;
            case 'granular':
                this.fxInput.connect(this.granularDryGain);
                this.granularDryGain.connect(this.fxOutput);
                this.fxInput.connect(this.granularNode);
                this.granularNode.connect(this.granularWetGain);
                this.granularWetGain.connect(this.fxOutput);
                break;
            case 'bypass':
            default:
                this.fxInput.connect(this.fxOutput);
                break;
        }
    }

    setEffect(type) {
        this.currentEffect = type;
        this.refreshEffectRouting();
        this.updateEffectParams(this.effectParams.x, this.effectParams.y);
    }

    updateEffectParams(x, y) {
        this.effectParams = { x, y };

        // IMPORTANT: Use the context of the node, not the global one.
        // This ensures it works for Offline Exporting.
        const ctx = this.fxInput.context;
        const t = ctx.currentTime;

        // Use setTargetAtTime for smooth live changes, but setValueAtTime if t=0 (Exporting)
        const setParam = (param, val) => {
            if (t === 0) param.setValueAtTime(val, 0);
            else param.setTargetAtTime(val, t, 0.02);
        };

        const expMap = (value, min, max) => {
            const logMin = Math.log(min);
            const logMax = Math.log(max);
            return Math.exp(logMin + value * (logMax - logMin));
        };

        switch (this.currentEffect) {
            case 'filter': {
                const fFreq = expMap(x, 80, 20000);
                setParam(this.filterNode.frequency, fFreq);
                setParam(this.filterNode.Q, 0.1 + y * 20);
                break;
            }
            case 'highpass': {
                const fFreq = expMap(x, 20, 8000);
                setParam(this.highpassNode.frequency, fFreq);
                setParam(this.highpassNode.Q, 0.1 + y * 20);
                break;
            }
            case 'bandpass': {
                const fFreq = expMap(x, 120, 12000);
                setParam(this.bandpassNode.frequency, fFreq);
                setParam(this.bandpassNode.Q, 0.1 + y * 20);
                break;
            }
            case 'autofilter': {
                const rate = 0.05 + x * 6.0;
                const depth = 300 + y * 6000;
                setParam(this.autoFilterNode.frequency, 500);
                setParam(this.autoFilterLfoGain.gain, depth);
                setParam(this.autoFilterLfo.frequency, rate);
                break;
            }
            case 'phaser': {
                const rate = 0.05 + x * 3.0;
                const depth = 200 + y * 1200;
                this.phaserFilters.forEach(filter => setParam(filter.frequency, 600 + y * 400));
                setParam(this.phaserLfoGain.gain, depth);
                setParam(this.phaserLfo.frequency, rate);
                setParam(this.phaserMix.gain, 0.7);
                break;
            }
            case 'flanger': {
                const rate = 0.05 + x * 2.0;
                const feedback = y * 0.75;
                setParam(this.flangerLfoGain.gain, 0.0005 + 0.003 * y);
                setParam(this.flangerDelay.delayTime, 0.002);
                setParam(this.flangerFeedback.gain, feedback);
                setParam(this.flangerLfo.frequency, rate);
                setParam(this.flangerMix.gain, 0.6);
                break;
            }
            case 'chorus': {
                const rate = 0.1 + x * 1.4;
                const depth = 0.002 + y * 0.015;
                setParam(this.chorusDelayL.delayTime, 0.008);
                setParam(this.chorusDelayR.delayTime, 0.012);
                setParam(this.chorusLfoGainL.gain, depth);
                setParam(this.chorusLfoGainR.gain, depth * 1.1);
                setParam(this.chorusLfoL.frequency, rate);
                setParam(this.chorusLfoR.frequency, rate * 1.1);
                setParam(this.chorusMix.gain, 0.7);
                break;
            }
            case 'tremolo': {
                const rate = 0.5 + x * 10.0;
                const depth = y;
                setParam(this.tremoloGain.gain, 1 - depth * 0.5);
                setParam(this.tremoloLfoGain.gain, depth * 0.5);
                setParam(this.tremoloLfo.frequency, rate);
                break;
            }
            case 'vibrato': {
                const rate = 2 + x * 10.0;
                const depth = 0.0005 + y * 0.005;
                setParam(this.vibratoDelay.delayTime, 0.004);
                setParam(this.vibratoLfoGain.gain, depth);
                setParam(this.vibratoLfo.frequency, rate);
                setParam(this.vibratoMix.gain, 0.7);
                break;
            }
            case 'delay': {
                setParam(this.delayNode.delayTime, x * 1.5);
                setParam(this.delayFeedback.gain, y * 0.85);
                setParam(this.delayMix.gain, 0.7);
                break;
            }
            case 'echo': {
                setParam(this.echoDelay.delayTime, x * 0.8);
                setParam(this.echoFeedback.gain, y * 0.6);
                setParam(this.echoLowpass.frequency, expMap(1 - y, 800, 5000));
                setParam(this.echoMix.gain, 0.6);
                break;
            }
            case 'pingpong': {
                setParam(this.pingpongDelayL.delayTime, x * 1.2);
                setParam(this.pingpongDelayR.delayTime, x * 1.2);
                setParam(this.pingpongFeedback.gain, y * 0.75);
                setParam(this.pingpongMix.gain, 0.7);
                break;
            }
            case 'reverb': {
                const seconds = 0.6 + x * 4.0;
                const decay = 1.0 + x * 4.0;
                if (Math.abs(this.reverbSeconds - seconds) > 0.05 || Math.abs(this.reverbDecay - decay) > 0.1) {
                    this.reverbSeconds = seconds;
                    this.reverbDecay = decay;
                    this.reverbNode.buffer = this.createImpulseResponse(ctx, seconds, decay);
                }
                setParam(this.reverbMix.gain, y);
                break;
            }
            case 'distortion': {
                this.distNode.curve = this.makeDistortionCurve(x * 600);
                setParam(this.distTone.frequency, expMap(1 - y, 800, 16000));
                break;
            }
            case 'overdrive': {
                this.overdriveNode.curve = this.makeOverdriveCurve(0.1 + x);
                setParam(this.overdriveTone.frequency, expMap(1 - y, 900, 14000));
                break;
            }
            case 'saturation': {
                this.saturationNode.curve = this.makeSaturationCurve(0.1 + x * 0.8);
                setParam(this.saturationTone.frequency, expMap(1 - y, 1000, 15000));
                break;
            }
            case 'bitcrusher': {
                this.bitcrusherNode.bits = 2 + Math.floor(x * 14);
                this.bitcrusherNode.normFreq = 0.05 + y * 0.95;
                break;
            }
            case 'compressor': {
                setParam(this.compressorNode.threshold, -60 + x * 50);
                setParam(this.compressorNode.ratio, 1 + y * 19);
                setParam(this.compressorNode.attack, 0.005);
                setParam(this.compressorNode.release, 0.12);
                break;
            }
            case 'limiter': {
                setParam(this.limiterNode.threshold, -20 + x * 20);
                setParam(this.limiterNode.ratio, 16);
                setParam(this.limiterNode.attack, 0.003);
                setParam(this.limiterNode.release, 0.02 + y * 0.18);
                break;
            }
            case 'widener': {
                setParam(this.widenerDelay.delayTime, x * 0.02);
                setParam(this.widenerWetGain.gain, y);
                setParam(this.widenerDryGain.gain, 1 - y * 0.7);
                break;
            }
            case 'panner': {
                setParam(this.pannerNode.pan, -1 + x * 2);
                setParam(this.pannerGain.gain, 0.5 + y * 0.5);
                break;
            }
            case 'pitch': {
                const semis = -12 + x * 24;
                const ratio = Math.pow(2, semis / 12);
                this.pitchNode.pitchRatio = ratio;
                setParam(this.pitchWetGain.gain, y);
                setParam(this.pitchDryGain.gain, 1 - y * 0.7);
                break;
            }
            case 'harmonizer': {
                const semis = 3 + x * 9;
                const ratio = Math.pow(2, semis / 12);
                this.harmonizerNode.pitchRatio = ratio;
                setParam(this.harmonizerWetGain.gain, y);
                setParam(this.harmonizerDryGain.gain, 1 - y * 0.6);
                break;
            }
            case 'granular': {
                const grainSeconds = 0.02 + x * 0.18;
                this.granularNode.grainSize = Math.floor(ctx.sampleRate * grainSeconds);
                this.granularNode.spray = y;
                setParam(this.granularWetGain.gain, 0.8);
                setParam(this.granularDryGain.gain, 1 - y * 0.6);
                break;
            }
            case 'bypass':
            default:
                break;
        }
    }

    setLocalRate(val) {
        this.localRate = val;
    }

    updateLivePlaybackRate(globalRate) {
        if (this.sourceNode && this.isPlaying) {
            const finalRate = this.localRate * globalRate;
            this.sourceNode.playbackRate.setValueAtTime(
                Math.max(0.1, Math.min(finalRate, 4.0)),
                this.sourceNode.context.currentTime
            );
        }
    }

    play(globalRate = 1.0) {
        if (!this.fxInput) return;
        this.stop();

        const ctx = getAudioContext();
        this.sourceNode = ctx.createBufferSource();
        this.sourceNode.buffer = this.buffer;
        this.sourceNode.loop = true;

        const finalRate = this.localRate * globalRate;
        this.sourceNode.playbackRate.value = Math.max(0.1, Math.min(finalRate, 4.0));

        const duration = this.buffer.duration;
        this.sourceNode.loopStart = duration * this.trimStart;
        this.sourceNode.loopEnd = duration * this.trimEnd;

        this.sourceNode.connect(this.fxInput);

        this.sourceNode.start(0, this.sourceNode.loopStart);
        this.isPlaying = true;
    }

    stop() {
        if (this.sourceNode) {
            try { this.sourceNode.stop(); } catch (e) {}
            this.sourceNode = null;
        }
        this.isPlaying = false;
    }

    destroy() {
        this.stop();
        if (this.gainNode) this.gainNode.disconnect();
    }
}
