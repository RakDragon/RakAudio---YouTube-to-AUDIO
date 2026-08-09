// ── Config ────────────────────────────────────────────────────────────────────
const apiHost  = (window.location.hostname && window.location.hostname !== '')
    ? window.location.hostname : '127.0.0.1';
const API_BASE = `http://${apiHost}:5050`;
const clientId = Math.random().toString(36).substring(2, 15);

/** S3: Strict YouTube URL regex — prevents accepting any string containing 'youtu'. */
const YT_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?|shorts\/)|youtu\.be\/)/;

// ── Application state ─────────────────────────────────────────────────────────
let videoDuration      = 0;
let currentVideoId     = '';
let currentExt         = '';
let audioUrlGlobal     = '';
let trimStartTime      = 0;
let trimEndTime        = 0;
let activeMode         = 'playhead';
let isEditedViewActive = false;
let globalVolValue     = 1.0;

// WaveSurfer instances
let wsGlobal     = null;
let wsTrim       = null;
let trimRegion   = null;
let currentEvtSource = null;

// rAF handles — batch audioprocess (~60fps) to 1 visual update per rendered frame
let rafGlobal = null;
let rafTrim   = null;

// Promise for reversed-audio preparation — awaited by toggleAudioReverseLive
// instead of polling with setInterval
let reversedAudioUrlPromise = null;
let reversedAudioUrl        = null;

let lastAppliedState = {
    start: 0, end: 0, fadeIn: 0, fadeOut: 0,
    adjustVol: false, volLevel: 1.0, tempo: 1.0,
    normalizeVol: false, pitch: 0, reverse: false,
};

// ── Cached DOM references ─────────────────────────────────────────────────────
const statusMsg        = document.getElementById('statusMsg');
const extractContainer = document.getElementById('extractContainer');
const btnProcess       = document.getElementById('btnProcess');
const btnPlayPause     = document.getElementById('btnPlayPause');
const trimModal        = document.getElementById('trimModal');

const lblCurrentTime  = document.getElementById('lblCurrentTime');
const lblTotalTime    = document.getElementById('lblTotalTime');

const inpStart        = document.getElementById('inpStart');
const inpEnd          = document.getElementById('inpEnd');
const lblTrimDuration = document.getElementById('lblTrimDuration');
const activeModeBadge = document.getElementById('activeModeBadge');

const outFormat  = document.getElementById('outFormat');
const outQuality = document.getElementById('outQuality');

const fInG        = document.getElementById('fadeInGlobal');
const fOutG       = document.getElementById('fadeOutGlobal');
const lblFadeInG  = document.getElementById('lblFadeInG');
const lblFadeOutG = document.getElementById('lblFadeOutG');

const chkAdjustVol    = document.getElementById('chkAdjustVol');
const volAdjustSlider = document.getElementById('volAdjustSlider');
const lblVolAdjust    = document.getElementById('lblVolAdjust');

const viewToggle      = document.getElementById('viewToggle');
const btnViewOriginal = document.getElementById('btnViewOriginal');
const btnViewEdited   = document.getElementById('btnViewEdited');
const volSlider       = document.getElementById('volSlider');
const lblVolGlobal    = document.getElementById('lblVolGlobal');
const btnApplyTrim    = document.getElementById('btnApplyTrim');

// Audio tool controls
const tempoSlider          = document.getElementById('tempoSlider');
const lblTempoValue        = document.getElementById('lblTempoValue');
const pitchSlider          = document.getElementById('pitchSlider');
const lblPitchValue        = document.getElementById('lblPitchValue');
const chkNormalizeVolModal = document.getElementById('chkNormalizeVolModal');
const chkReverseAudio      = document.getElementById('chkReverseAudio');

// Trim modal controls (M6: cached — were looked up on every play/pause event)
const btnPlayTrim = document.getElementById('btnPlayTrim');
const lblPlayTrim = document.getElementById('lblPlayTrim');

// Waveform container + canvas elements (A2/M4: cached — were re-queried per renderVisualFades call)
const waveformContainerEl     = document.getElementById('waveformContainer');
const waveformTrimContainerEl = document.getElementById('waveformTrimContainer');
const waveformEl              = document.getElementById('waveform');
const waveformTrimEl          = document.getElementById('waveformTrim');
const waveformOverlay         = document.getElementById('waveformLoadingOverlay');

// Metadata display
const metadataSection  = document.getElementById('metadataSection');
const editorSection    = document.getElementById('editorSection');
const downloadSection  = document.getElementById('downloadSection');
const metaThumb        = document.getElementById('metaThumb');
const metaTitle        = document.getElementById('metaTitle');
const metaChannel      = document.getElementById('metaChannel');
const metaViews        = document.getElementById('metaViews');
const metaDate         = document.getElementById('metaDate');
const metaDuration     = document.getElementById('metaDuration');
const ytUrlInput       = document.getElementById('ytUrl');

// Keyboard shortcut elements (updateKeyboardUI uses these without any live DOM query)
const kbdMap = {
    'k-1':        document.getElementById('k-1'),
    'k-2':        document.getElementById('k-2'),
    'k-3':        document.getElementById('k-3'),
    'k-space':    document.getElementById('k-space'),
    'k-up':       document.getElementById('k-up'),
    'k-down':     document.getElementById('k-down'),
    'k-ctrl-ms':  document.getElementById('k-ctrl-ms'),
    'k-shift-ms': document.getElementById('k-shift-ms'),
    'k-left-ms':  document.getElementById('k-left-ms'),
    'k-right-ms': document.getElementById('k-right-ms'),
    'k-shift-5':  document.getElementById('k-shift-5'),
    'k-left-5':   document.getElementById('k-left-5'),
    'k-right-5':  document.getElementById('k-right-5'),
    'k-ctrl-1':   document.getElementById('k-ctrl-1'),
    'k-left-1':   document.getElementById('k-left-1'),
    'k-right-1':  document.getElementById('k-right-1'),
    'k-left-10':  document.getElementById('k-left-10'),
    'k-right-10': document.getElementById('k-right-10'),
};
const descMap = {
    't-foco': document.getElementById('t-foco'),
    't-vol':  document.getElementById('t-vol'),
    't-5s':   document.getElementById('t-5s'),
    't-ms':   document.getElementById('t-ms'),
    't-play': document.getElementById('t-play'),
    't-10s':  document.getElementById('t-10s'),
    't-1s':   document.getElementById('t-1s'),
};

// ── Constants ─────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'rak_audio_history';
const HISTORY_MAX = 10;

/** Shared WaveSurfer visual options applied to both instances. */
const WAVESURFER_OPTS = {
    waveColor:     '#777777',
    progressColor: '#FF422E',
    cursorColor:   '#ffffff',
    barWidth:      2,
    barRadius:     2,
};

/** Hover plugin options shared between both WaveSurfer instances. */
const HOVER_OPTS = {
    lineColor:       '#FF422E',
    lineWidth:       2,
    labelBackground: '#FF422E',
    labelColor:      '#fff',
    labelSize:       '11px',
};

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Round a value to 2 decimal places.
 * Replaces the verbose parseFloat(parseFloat(x).toFixed(2)) pattern (M3).
 */
function round2(x) {
    return Math.round(Number(x) * 100) / 100;
}

/** Format seconds as m:ss. */
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function showWaveformLoading() { waveformOverlay?.classList.remove('hidden'); }
function hideWaveformLoading() { waveformOverlay?.classList.add('hidden');    }

function showStatus(msg, isError = false) {
    statusMsg.textContent = msg;
    statusMsg.classList.remove('hidden');
    statusMsg.className = `text-sm mt-2 block z-10 font-mono text-white${isError ? ' font-bold text-[#FF422E]' : ''}`;
}

// ── History ───────────────────────────────────────────────────────────────────
function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch { return []; }
}

function saveToHistory(item) {
    const list = loadHistory().filter(i => i.id !== item.id);
    list.unshift(item);
    if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistory();
}

function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
}

/**
 * Build the history list using DocumentFragment + textContent.
 * No innerHTML interpolation (XSS-safe). Listeners attached inline — no
 * secondary querySelectorAll sweep needed.
 */
function renderHistory() {
    const historySection = document.getElementById('historySection');
    const historyList    = document.getElementById('historyList');
    if (!historySection || !historyList) return;

    const list = loadHistory();
    if (list.length === 0) {
        historySection.classList.add('hidden');
        historyList.innerHTML = '';
        return;
    }

    historySection.classList.remove('hidden');
    const fragment = document.createDocumentFragment();

    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'bg-[#1f1f1f] p-3 rounded-lg border border-[#444] flex items-center gap-3 hover:border-[#FF422E] transition group';

        const img = document.createElement('img');
        img.src = item.thumbnailUrl || '';
        img.alt = 'Portada';
        img.className = 'w-20 h-14 object-cover rounded border border-[#333]';
        img.loading = 'lazy';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'flex-1 min-w-0';

        const h4 = document.createElement('h4');
        h4.className   = 'text-sm font-bold text-white truncate group-hover:text-[#FF422E] transition';
        h4.textContent = item.title || 'Sin título';

        const p = document.createElement('p');
        p.className   = 'text-xs text-gray-400 truncate';
        p.textContent = `${item.uploader || 'Desconocido'} • ${formatTime(item.duration)}`;

        infoDiv.appendChild(h4);
        infoDiv.appendChild(p);

        const btn = document.createElement('button');
        btn.className   = 'btn-reload-history bg-[#FF422E] hover:bg-[#d43726] px-3 py-1.5 rounded text-xs font-bold text-white transition flex-shrink-0';
        btn.textContent = 'Cargar';
        btn.dataset.url = item.url || '';
        btn.addEventListener('click', (e) => {
            const targetUrl = e.currentTarget.dataset.url;
            if (targetUrl) {
                ytUrlInput.value = targetUrl;
                document.getElementById('btnExtraer').click();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });

        div.appendChild(img);
        div.appendChild(infoDiv);
        div.appendChild(btn);
        fragment.appendChild(div);
    });

    historyList.innerHTML = '';
    historyList.appendChild(fragment);
}

// ── Editor state ──────────────────────────────────────────────────────────────

/**
 * Snapshot the current editor control values.
 * Single source of truth used by checkIfStateChanged and btnApplyTrim.
 */
function readEditorState() {
    return {
        start:        round2(trimStartTime),
        end:          round2(trimEndTime),
        fadeIn:       round2(fInG.value)  || 0,
        fadeOut:      round2(fOutG.value) || 0,
        adjustVol:    chkAdjustVol.checked,
        volLevel:     round2(volAdjustSlider.value),
        tempo:        round2(tempoSlider        ? tempoSlider.value        : 1.0),
        normalizeVol: chkNormalizeVolModal      ? chkNormalizeVolModal.checked : false,
        pitch:        parseInt(pitchSlider      ? pitchSlider.value        : 0, 10),
        reverse:      chkReverseAudio           ? chkReverseAudio.checked  : false,
    };
}

/**
 * Reset all editor controls to neutral defaults.
 * Called when a new video is loaded (M5: extracted from btnExtraer handler).
 */
function resetEditorControls() {
    if (tempoSlider)  { tempoSlider.value  = 1.0; if (lblTempoValue) lblTempoValue.textContent = '1.00x'; }
    if (pitchSlider)  { pitchSlider.value  = 0;   if (lblPitchValue) lblPitchValue.textContent = '0 semitonos'; }
    if (chkNormalizeVolModal) chkNormalizeVolModal.checked = false;
    if (chkReverseAudio)      chkReverseAudio.checked      = false;

    fInG.value  = 0; lblFadeInG.textContent  = '0s';
    fOutG.value = 0; lblFadeOutG.textContent = '0s';

    chkAdjustVol.checked     = false;
    volAdjustSlider.value    = 1.0;
    lblVolAdjust.textContent = '100%';
    volAdjustSlider.disabled = true;
    volAdjustSlider.classList.add('opacity-50', 'pointer-events-none');
    lblVolAdjust.classList.add('opacity-50');
}

/** Enable / disable the "Aplicar" button based on whether settings have changed. */
function checkIfStateChanged() {
    if (!btnApplyTrim) return;

    const cur  = readEditorState();
    const prev = lastAppliedState;

    const isSame =
        Math.abs(cur.start   - prev.start)   < 0.01 &&
        Math.abs(cur.end     - prev.end)     < 0.01 &&
        Math.abs(cur.fadeIn  - prev.fadeIn)  < 0.01 &&
        Math.abs(cur.fadeOut - prev.fadeOut) < 0.01 &&
        cur.adjustVol === prev.adjustVol &&
        (!cur.adjustVol || Math.abs(cur.volLevel - prev.volLevel) < 0.01) &&
        Math.abs(cur.tempo - (prev.tempo || 1.0)) < 0.01 &&
        cur.normalizeVol === (prev.normalizeVol || false) &&
        cur.pitch   === (prev.pitch   || 0)     &&
        cur.reverse === (prev.reverse || false);

    btnApplyTrim.disabled = isSame;
    btnApplyTrim.classList.toggle('opacity-40',          isSame);
    btnApplyTrim.classList.toggle('cursor-not-allowed',  isSame);
    btnApplyTrim.classList.toggle('pointer-events-none', isSame);
    btnApplyTrim.classList.toggle('hover:bg-[#d43726]', !isSame);
}

// ── Time display ──────────────────────────────────────────────────────────────
function updateTimeDisplay() {
    if (!wsGlobal) return;
    const cur = wsGlobal.getCurrentTime();
    if (isEditedViewActive) {
        lblCurrentTime.textContent = formatTime(Math.max(0, cur - trimStartTime));
        lblTotalTime.textContent   = formatTime(Math.max(0, trimEndTime - trimStartTime));
    } else {
        lblCurrentTime.textContent = formatTime(cur);
        lblTotalTime.textContent   = formatTime(videoDuration);
    }
}

// ── Trim progress bar (A3: elevated to module scope; uses cached btnPlayTrim) ──
function updateTrimProgressUI() {
    if (!wsTrim || !btnPlayTrim) return;

    if (wsTrim.getCurrentTime() >= trimEndTime) {
        wsTrim.pause();
        wsTrim.setTime(trimStartTime);
        btnPlayTrim.style.setProperty('--trim-progress', '0%');
    } else {
        applyLiveAudioMath(wsTrim, false);
        const duration = trimEndTime - trimStartTime;
        if (duration > 0 && wsTrim.isPlaying()) {
            const elapsed = wsTrim.getCurrentTime() - trimStartTime;
            const pct     = Math.min(100, Math.max(0, (elapsed / duration) * 100));
            btnPlayTrim.style.setProperty('--trim-progress', `${pct.toFixed(1)}%`);
        }
    }
}

// ── Live audio math ───────────────────────────────────────────────────────────

/**
 * Apply real-time fade envelope, volume, tempo and pitch to a WaveSurfer instance.
 * Called from the rAF-throttled audioprocess callback — must stay cheap.
 * All element references are cached at module level (no getElementById calls).
 */
function applyLiveAudioMath(ws, isGlobalEdited) {
    if (!ws) return;

    const currentTime = ws.getCurrentTime();
    const start = isGlobalEdited ? trimStartTime : (ws === wsTrim ? trimStartTime : 0);
    const end   = isGlobalEdited ? trimEndTime   : (ws === wsTrim ? trimEndTime   : videoDuration);
    const t     = currentTime - start;

    const inSec  = parseFloat(fInG.value);
    const outSec = parseFloat(fOutG.value);

    let maxVol = (ws === wsTrim || isGlobalEdited)
        ? (chkAdjustVol.checked ? parseFloat(volAdjustSlider.value) : 1.0)
        : globalVolValue;

    // EBU R128 live preview: +3.5 dB ≈ ×1.45 gain
    if (chkNormalizeVolModal?.checked && (ws === wsTrim || isGlobalEdited)) {
        maxVol *= 1.45;
    }

    let vol = maxVol;
    if (inSec > 0 && t < inSec && t >= 0) {
        vol = maxVol * (t / inSec);
    } else if (outSec > 0 && currentTime > (end - outSec) && currentTime <= end) {
        vol = maxVol * ((end - currentTime) / outSec);
    }

    ws.setVolume(Math.max(0, Math.min(2.0, vol)));

    const tempoVal    = parseFloat(tempoSlider ? tempoSlider.value : 1.0);
    const pitchVal    = parseInt(pitchSlider   ? pitchSlider.value : 0, 10); // E2: explicit radix
    const pitchFactor = Math.pow(2, pitchVal / 12);
    const rate        = Math.max(0.25, Math.min(4.0, tempoVal * pitchFactor));

    try {
        ws.setPlaybackRate(rate, pitchVal === 0);
    } catch {
        // Browser cap exceeded — silently ignore
    }
}

// ── Visual fade overlays ──────────────────────────────────────────────────────

/**
 * Render trim/fade visual overlays onto the waveform container.
 * A2: Accepts an HTMLElement directly instead of an ID string — eliminates
 * the internal getElementById call on every invocation.
 *
 * @param {HTMLElement} container
 * @param {boolean} isGlobalEdited
 */
function renderVisualFades(container, isGlobalEdited) {
    const dur    = videoDuration || 1;
    const startP = (trimStartTime / dur) * 100;
    const endP   = (trimEndTime   / dur) * 100;
    const inSec  = parseFloat(fInG.value);
    const outSec = parseFloat(fOutG.value);

    if (isGlobalEdited) {
        container.querySelectorAll('.visual-fx').forEach(el => el.remove());

        /** Helper to create a positioned overlay div. */
        function overlay(classes, styles) {
            const el = document.createElement('div');
            el.className = classes;
            Object.assign(el.style, styles);
            return el;
        }

        container.appendChild(overlay('visual-fx blackout-overlay', { width: `${startP}%`,       left:  '0' }));
        container.appendChild(overlay('visual-fx blackout-overlay', { width: `${100 - endP}%`,   right: '0' }));
        container.appendChild(overlay('visual-fx fade-overlay',     { left: `${startP}%`, width: '2px', backgroundColor: '#FF422E', boxShadow: '0 0 6px #FF422E', zIndex: '15' }));
        container.appendChild(overlay('visual-fx fade-overlay',     { left: `${endP}%`,   width: '2px', backgroundColor: '#FF422E', boxShadow: '0 0 6px #FF422E', zIndex: '15' }));

        if (inSec > 0) {
            container.appendChild(overlay('visual-fx fade-overlay fade-in-gradient',  { left: `${startP}%`,                              width: `${(inSec / dur) * 100}%` }));
        }
        if (outSec > 0) {
            container.appendChild(overlay('visual-fx fade-overlay fade-out-gradient', { left: `${((trimEndTime - outSec) / dur) * 100}%`, width: `${(outSec / dur) * 100}%` }));
        }
    } else {
        // Trim view: update CSS custom properties on the region element
        const regionDur = (trimEndTime - trimStartTime) || 1;
        waveformTrimEl.style.setProperty('--fade-in-width',  `${Math.min(100, (inSec  / regionDur) * 100)}%`);
        waveformTrimEl.style.setProperty('--fade-out-width', `${Math.min(100, (outSec / regionDur) * 100)}%`);
    }
}

// ── Spectrum flip ─────────────────────────────────────────────────────────────
function updateSpectrumFlipUI() {
    const isReverse = chkReverseAudio?.checked ?? false;
    // M4: uses cached waveformTrimEl / waveformEl
    waveformTrimEl?.classList.toggle('spectrum-reversed', isReverse);
    waveformEl?.classList.toggle('spectrum-reversed', isEditedViewActive && isReverse);
}

// ── Active mode badge ─────────────────────────────────────────────────────────
function setActiveMode(mode) {
    activeMode = mode;
    if (!activeModeBadge) return;

    const isEdge = mode === 'left' || mode === 'right';
    activeModeBadge.textContent = mode === 'left'  ? 'Ajuste Límite Izquierdo (1)'
                                : mode === 'right' ? 'Ajuste Límite Derecho (3)'
                                :                    'Moviendo Cabezal (2)';
    activeModeBadge.className = [
        'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all',
        isEdge ? 'bg-[#FF422E] text-white shadow-[0_0_8px_rgba(255,66,46,0.6)]'
               : 'bg-[#444444] text-white shadow-[0_0_8px_rgba(255,255,255,0.2)]',
    ].join(' ');
}

// ── Global view (Original ↔ Edited) ──────────────────────────────────────────
function setGlobalView(edited) {
    isEditedViewActive = edited;

    const isReverse = chkReverseAudio?.checked ?? false;
    let targetUrl   = audioUrlGlobal;

    if (edited) {
        btnViewEdited.classList.replace('text-gray-400', 'text-white');
        btnViewEdited.classList.replace('hover:text-white', 'bg-[#FF422E]');
        btnViewOriginal.classList.replace('bg-[#FF422E]', 'hover:text-white');
        btnViewOriginal.classList.replace('text-white', 'text-gray-400');

        volSlider.disabled = true;
        volSlider.classList.add('opacity-50', 'cursor-not-allowed');

        const editVol = chkAdjustVol.checked ? parseFloat(volAdjustSlider.value) : 1.0;
        volSlider.max   = '2';
        volSlider.value = editVol;
        lblVolGlobal.textContent = `${Math.round(editVol * 100)}%`;

        renderVisualFades(waveformContainerEl, true);
        if (isReverse && reversedAudioUrl) targetUrl = reversedAudioUrl;
    } else {
        btnViewOriginal.classList.replace('text-gray-400', 'text-white');
        btnViewOriginal.classList.replace('hover:text-white', 'bg-[#FF422E]');
        btnViewEdited.classList.replace('bg-[#FF422E]', 'hover:text-white');
        btnViewEdited.classList.replace('text-white', 'text-gray-400');

        volSlider.disabled = false;
        volSlider.classList.remove('opacity-50', 'cursor-not-allowed');
        volSlider.max   = '1';
        volSlider.value = globalVolValue;
        lblVolGlobal.textContent = `${Math.round(globalVolValue * 100)}%`;

        waveformContainerEl.querySelectorAll('.visual-fx').forEach(el => el.remove());
    }

    if (wsGlobal) {
        window.isSwitchingView = true;
        const wasPlaying  = wsGlobal.isPlaying();
        const curTime     = wsGlobal.getCurrentTime();
        const currentSrc  = wsGlobal.getMediaElement().src;
        const needsSwitch = !currentSrc.endsWith(targetUrl) && currentSrc !== targetUrl;

        if (btnPlayPause) {
            btnPlayPause.disabled = true;
            btnPlayPause.classList.add('opacity-50', 'cursor-not-allowed');
            btnPlayPause.textContent = wasPlaying ? 'Pause' : 'Play';
        }

        const finalize = () => {
            window.isSwitchingView = false;
            if (btnPlayPause) {
                btnPlayPause.disabled = false;
                btnPlayPause.classList.remove('opacity-50', 'cursor-not-allowed');
                btnPlayPause.textContent = wasPlaying ? 'Pause' : 'Play';
            }
        };

        const applyState = () => {
            requestAnimationFrame(() => {
                if (edited) {
                    const newTime = (curTime < trimStartTime || curTime > trimEndTime)
                        ? trimStartTime : curTime;
                    if (needsSwitch || newTime !== curTime) wsGlobal.setTime(newTime);
                    applyLiveAudioMath(wsGlobal, true);
                } else {
                    try { wsGlobal.setPlaybackRate(1.0, true); } catch {}
                    wsGlobal.setVolume(globalVolValue);
                    if (needsSwitch) wsGlobal.setTime(curTime);
                }
                if (wasPlaying) {
                    wsGlobal.play().finally(() => requestAnimationFrame(finalize));
                } else {
                    requestAnimationFrame(finalize);
                }
            });
        };

        if (needsSwitch) {
            if (wasPlaying) wsGlobal.pause();
            showWaveformLoading();
            wsGlobal.once('decode', () => { hideWaveformLoading(); applyState(); });
            wsGlobal.load(targetUrl);
        } else {
            applyState();
        }
    }

    updateSpectrumFlipUI();
    updateTimeDisplay();
}

btnViewOriginal.addEventListener('click', () => setGlobalView(false));
btnViewEdited.addEventListener('click',   () => setGlobalView(true));

// ── Format selector ───────────────────────────────────────────────────────────
outFormat.addEventListener('change', (e) => {
    const isWav = e.target.value === 'wav';
    outQuality.disabled = isWav;
    outQuality.classList.toggle('opacity-50',        isWav);
    outQuality.classList.toggle('cursor-not-allowed', isWav);
});

// ── WaveSurfer — main waveform ────────────────────────────────────────────────
function initWaveSurfer() {
    // Cancel pending rAF before destroying old instance to prevent stale callbacks
    if (rafGlobal) { cancelAnimationFrame(rafGlobal); rafGlobal = null; }
    if (wsGlobal)  wsGlobal.destroy();

    showWaveformLoading();

    wsGlobal = WaveSurfer.create({
        ...WAVESURFER_OPTS,
        container: '#waveform',
        height:    96,
        url:       audioUrlGlobal,
        plugins:   [WaveSurfer.Hover.create(HOVER_OPTS)],
    });

    wsGlobal.on('play',  () => { if (!window.isSwitchingView) btnPlayPause.textContent = 'Pause'; });
    wsGlobal.on('pause', () => { if (!window.isSwitchingView) btnPlayPause.textContent = 'Play';  });

    wsGlobal.on('ready', () => {
        hideWaveformLoading();
        updateTimeDisplay();
        wsGlobal.setVolume(globalVolValue);

        metadataSection.classList.remove('hidden');
        editorSection.classList.remove('hidden');
        downloadSection.classList.remove('hidden');

        showStatus('¡Audio cargado y listo!');
        setTimeout(() => statusMsg.classList.add('hidden'), 3000);
    });

    wsGlobal.on('error', hideWaveformLoading);

    // audioprocess fires ~60fps; rAF throttle batches updates to 1 per rendered frame
    wsGlobal.on('audioprocess', () => {
        if (rafGlobal) return;
        rafGlobal = requestAnimationFrame(() => {
            rafGlobal = null;
            updateTimeDisplay();
            if (isEditedViewActive) {
                if (wsGlobal.getCurrentTime() >= trimEndTime) {
                    wsGlobal.pause();
                    wsGlobal.setTime(trimStartTime);
                } else {
                    applyLiveAudioMath(wsGlobal, true);
                }
            } else {
                wsGlobal.setVolume(globalVolValue);
            }
        });
    });

    wsGlobal.on('interaction', () => {
        if (isEditedViewActive) {
            const t = wsGlobal.getCurrentTime();
            if (t < trimStartTime || t > trimEndTime) wsGlobal.setTime(trimStartTime);
            applyLiveAudioMath(wsGlobal, true);
        }
        updateTimeDisplay();
    });
}

// ── Playback controls (S4/S5: all guarded — wsGlobal may be null before load) ─
btnPlayPause.addEventListener('click', () => {
    if (!wsGlobal) return;
    if (isEditedViewActive && wsGlobal.getCurrentTime() < trimStartTime) {
        wsGlobal.setTime(trimStartTime);
    }
    wsGlobal.playPause();
});

document.getElementById('btnStart').addEventListener('click', () => {
    if (!wsGlobal) return;
    wsGlobal.seekTo(isEditedViewActive ? (trimStartTime / videoDuration) : 0);
});
document.getElementById('btnEnd').addEventListener('click', () => {
    if (!wsGlobal) return;
    wsGlobal.seekTo(isEditedViewActive ? (trimEndTime / videoDuration) : 1);
});
document.getElementById('btnMinus10').addEventListener('click', () => { if (wsGlobal) wsGlobal.skip(-10); });
document.getElementById('btnMinus5').addEventListener('click',  () => { if (wsGlobal) wsGlobal.skip(-5);  });
document.getElementById('btnPlus5').addEventListener('click',   () => { if (wsGlobal) wsGlobal.skip(5);   });
document.getElementById('btnPlus10').addEventListener('click',  () => { if (wsGlobal) wsGlobal.skip(10);  });

volSlider.addEventListener('input', (e) => {
    if (!isEditedViewActive) {
        globalVolValue = Number(e.target.value);
        lblVolGlobal.textContent = `${Math.round(globalVolValue * 100)}%`;
        if (wsGlobal) wsGlobal.setVolume(globalVolValue);
    }
});

// ── Extract ───────────────────────────────────────────────────────────────────
document.getElementById('btnExtraer').addEventListener('click', async () => {
    const url = ytUrlInput.value.trim();

    if (!YT_URL_REGEX.test(url)) return showStatus('Enlace de YouTube no válido.', true);

    if (currentEvtSource) currentEvtSource.close();
    viewToggle.classList.add('hidden');
    setGlobalView(false);

    if (wsTrim) { wsTrim.destroy(); wsTrim = null; trimRegion = null; }

    currentEvtSource = new EventSource(`${API_BASE}/api/progress?client_id=${clientId}`);
    currentEvtSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        extractContainer.style.setProperty('--progress', `${data.progress}%`);
        showStatus(data.msg);
        if (data.status === 'done' || data.status === 'error') currentEvtSource.close();
    };

    try {
        const res  = await fetch(`${API_BASE}/api/extract`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ url, client_id: clientId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        currentVideoId = data.id;
        currentExt     = data.ext;
        audioUrlGlobal = data.audioUrl;

        // Start reversed-audio preparation in background; store Promise so
        // toggleAudioReverseLive can await it without polling.
        if (reversedAudioUrl) { URL.revokeObjectURL(reversedAudioUrl); reversedAudioUrl = null; }
        reversedAudioUrlPromise = prepareReversedAudioUrl(data.audioUrl);

        metaTitle.textContent    = data.title;
        metaChannel.textContent  = data.uploader;
        metaViews.textContent    = parseInt(data.views, 10).toLocaleString(); // E2: radix
        metaDate.textContent     = data.uploadDate;
        metaThumb.src            = data.thumbnailUrl;
        
        const metadataBg = document.getElementById('metadataBg');
        if (metadataBg) metadataBg.style.backgroundImage = `url('${data.thumbnailUrl}')`;

        metaDuration.textContent = formatTime(data.duration);

        videoDuration = data.duration;
        trimStartTime = 0;
        trimEndTime   = videoDuration;

        lastAppliedState = {
            start: 0, end: round2(videoDuration),
            fadeIn: 0, fadeOut: 0, adjustVol: false, volLevel: 1.0,
            tempo: 1.0, normalizeVol: false, pitch: 0, reverse: false,
        };

        resetEditorControls(); // M5: extracted helper

        saveToHistory({
            id: data.id, title: data.title, uploader: data.uploader,
            uploadDate: data.uploadDate, thumbnailUrl: data.thumbnailUrl,
            duration: data.duration, url,
        });

        showStatus('Decodificando el audio (esto puede tardar unos segundos)...');
        initWaveSurfer();

        setTimeout(() => extractContainer.style.setProperty('--progress', '0%'), 2000);

    } catch (err) {
        if (currentEvtSource) currentEvtSource.close();
        extractContainer.style.setProperty('--progress', '0%');
        showStatus(err.message || 'Error de conexión con el servidor Python.', true);
        console.error(err);
    }
});

// ── Trim modal ────────────────────────────────────────────────────────────────
document.getElementById('btnOpenTrim').addEventListener('click', () => {
    trimModal.classList.remove('hidden');
    setActiveMode('playhead');

    if (btnPlayTrim) btnPlayTrim.style.setProperty('--trim-progress', '0%');
    if (lblPlayTrim) lblPlayTrim.textContent = 'Escuchar Selección';

    if (wsGlobal?.isPlaying()) wsGlobal.pause();

    if (!wsTrim) {
        if (rafTrim) { cancelAnimationFrame(rafTrim); rafTrim = null; }

        const wsRegions = WaveSurfer.Regions.create();
        wsTrim = WaveSurfer.create({
            ...WAVESURFER_OPTS,
            container:  '#waveformTrim',
            height:     'auto',
            url:        audioUrlGlobal,
            dragToSeek: true,
            plugins:    [wsRegions, WaveSurfer.Hover.create(HOVER_OPTS)],
        });

        // M6: uses cached btnPlayTrim / lblPlayTrim refs
        wsTrim.on('play',  () => { if (lblPlayTrim) lblPlayTrim.textContent = 'Pausar Selección'; });
        wsTrim.on('pause', () => {
            if (lblPlayTrim) lblPlayTrim.textContent = 'Escuchar Selección';
            if (btnPlayTrim) btnPlayTrim.style.setProperty('--trim-progress', '0%');
        });

        wsTrim.on('decode', () => {
            wsRegions.clearRegions();
            trimRegion = wsRegions.addRegion({
                start: trimStartTime, end: trimEndTime,
                color: 'rgba(255, 66, 46, 0.3)',
                drag: false, resize: true,
            });

            inpStart.value = trimStartTime.toFixed(2);
            inpEnd.value   = trimEndTime.toFixed(2);
            lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);

            renderVisualFades(waveformTrimContainerEl, false); // A2: element ref
            applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();

            trimRegion.on('update', () => {
                let cs = trimRegion.start;
                let ce = trimRegion.end;
                const snap = 0.35;

                if (Math.abs(cs - lastAppliedState.start) < snap) { cs = lastAppliedState.start; trimRegion.setOptions({ start: cs }); }
                else if (cs < snap)                                { cs = 0;                      trimRegion.setOptions({ start: cs }); }

                if (Math.abs(ce - lastAppliedState.end) < snap)   { ce = lastAppliedState.end;   trimRegion.setOptions({ end: ce }); }
                else if (Math.abs(ce - videoDuration) < snap)      { ce = videoDuration;           trimRegion.setOptions({ end: ce }); }

                if (cs !== trimStartTime && ce === trimEndTime) setActiveMode('left');
                else if (ce !== trimEndTime && cs === trimStartTime) setActiveMode('right');

                trimStartTime = cs;
                trimEndTime   = ce;

                inpStart.value = trimStartTime.toFixed(2);
                inpEnd.value   = trimEndTime.toFixed(2);
                lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);

                renderVisualFades(waveformTrimContainerEl, false);
                applyLiveAudioMath(wsTrim, false);
                checkIfStateChanged();
            });

            trimRegion.on('update-end', checkIfStateChanged);
        });

        wsTrim.on('interaction', () => {
            setActiveMode('playhead');
            const t = wsTrim.getCurrentTime();
            if (t < trimStartTime || t > trimEndTime) wsTrim.setTime(trimStartTime);
            applyLiveAudioMath(wsTrim, false);
        });

        // rAF throttle: batch audioprocess to 1 visual update per frame.
        // A3: updateTrimProgressUI is now module-scoped (no closure over stale values).
        wsTrim.on('audioprocess', () => {
            if (rafTrim) return;
            rafTrim = requestAnimationFrame(() => { rafTrim = null; updateTrimProgressUI(); });
        });

    } else {
        applyLiveAudioMath(wsTrim, false);
        checkIfStateChanged();
    }
});

document.getElementById('btnCloseTrim').addEventListener('click', () => {
    if (wsTrim?.isPlaying()) wsTrim.pause();
    if (btnPlayTrim) btnPlayTrim.style.setProperty('--trim-progress', '0%');
    if (lblPlayTrim) lblPlayTrim.textContent = 'Escuchar Selección';
    trimModal.classList.add('hidden');
});

btnApplyTrim.addEventListener('click', () => {
    if (btnApplyTrim.disabled) return;
    if (wsTrim?.isPlaying()) wsTrim.pause();

    lastAppliedState = readEditorState(); // single source of truth

    if (btnPlayTrim) btnPlayTrim.style.setProperty('--trim-progress', '0%');
    if (lblPlayTrim) lblPlayTrim.textContent = 'Escuchar Selección';

    trimModal.classList.add('hidden');
    viewToggle.classList.remove('hidden');
    setGlobalView(true);
    checkIfStateChanged();
});

btnPlayTrim.addEventListener('click', () => {
    if (!wsTrim) return;
    if (wsTrim.isPlaying()) {
        wsTrim.pause();
    } else {
        if (wsTrim.getCurrentTime() < trimStartTime || wsTrim.getCurrentTime() > trimEndTime) {
            wsTrim.setTime(trimStartTime);
        }
        wsTrim.play();
    }
});

// ── Trim input fields ─────────────────────────────────────────────────────────
inpStart.addEventListener('input', checkIfStateChanged);
inpStart.addEventListener('change', (e) => {
    const val = Math.max(0, Math.min(parseFloat(e.target.value) || 0, trimEndTime - 0.01));
    trimStartTime  = val;
    e.target.value = val.toFixed(2);
    if (trimRegion) trimRegion.setOptions({ start: trimStartTime });
    lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
    renderVisualFades(waveformTrimContainerEl, false);
    if (wsTrim) applyLiveAudioMath(wsTrim, false);
    checkIfStateChanged();
});

inpEnd.addEventListener('input', checkIfStateChanged);
inpEnd.addEventListener('change', (e) => {
    const val = Math.min(videoDuration, Math.max(parseFloat(e.target.value) || 0, trimStartTime + 0.01));
    trimEndTime    = val;
    e.target.value = val.toFixed(2);
    if (trimRegion) trimRegion.setOptions({ end: trimEndTime });
    lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
    renderVisualFades(waveformTrimContainerEl, false);
    if (wsTrim) applyLiveAudioMath(wsTrim, false);
    checkIfStateChanged();
});

// ── Fade sliders ──────────────────────────────────────────────────────────────
fInG.addEventListener('input', () => {
    lblFadeInG.textContent = `${fInG.value}s`;
    if (wsTrim) { renderVisualFades(waveformTrimContainerEl, false); applyLiveAudioMath(wsTrim, false); }
    if (isEditedViewActive && wsGlobal) { renderVisualFades(waveformContainerEl, true); applyLiveAudioMath(wsGlobal, true); }
    checkIfStateChanged();
});

fOutG.addEventListener('input', () => {
    lblFadeOutG.textContent = `${fOutG.value}s`;
    if (wsTrim) { renderVisualFades(waveformTrimContainerEl, false); applyLiveAudioMath(wsTrim, false); }
    if (isEditedViewActive && wsGlobal) { renderVisualFades(waveformContainerEl, true); applyLiveAudioMath(wsGlobal, true); }
    checkIfStateChanged();
});

// ── Volume adjust ─────────────────────────────────────────────────────────────
chkAdjustVol.addEventListener('change', (e) => {
    const on = e.target.checked;
    volAdjustSlider.disabled = !on;
    volAdjustSlider.classList.toggle('opacity-50',         !on);
    volAdjustSlider.classList.toggle('pointer-events-none', !on);
    lblVolAdjust.classList.toggle('opacity-50', !on);
    if (wsTrim) applyLiveAudioMath(wsTrim, false);
    checkIfStateChanged();
});

volAdjustSlider.addEventListener('input', (e) => {
    lblVolAdjust.textContent = `${Math.round(e.target.value * 100)}%`;
    if (chkAdjustVol.checked && wsTrim) applyLiveAudioMath(wsTrim, false);
    checkIfStateChanged();
});

// ── Audio tool controls ───────────────────────────────────────────────────────
if (tempoSlider && lblTempoValue) {
    tempoSlider.addEventListener('input', (e) => {
        lblTempoValue.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
        if (wsTrim) applyLiveAudioMath(wsTrim, false);
        if (isEditedViewActive && wsGlobal) applyLiveAudioMath(wsGlobal, true);
        checkIfStateChanged();
    });
}

if (pitchSlider && lblPitchValue) {
    pitchSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10); // E2: explicit radix
        lblPitchValue.textContent = `${val > 0 ? '+' : ''}${val} semitonos`;
        if (wsTrim) applyLiveAudioMath(wsTrim, false);
        if (isEditedViewActive && wsGlobal) applyLiveAudioMath(wsGlobal, true);
        checkIfStateChanged();
    });
}

if (chkNormalizeVolModal) {
    chkNormalizeVolModal.addEventListener('change', () => {
        if (wsTrim) applyLiveAudioMath(wsTrim, false);
        if (isEditedViewActive && wsGlobal) applyLiveAudioMath(wsGlobal, true);
        checkIfStateChanged();
    });
}

if (chkReverseAudio) {
    chkReverseAudio.addEventListener('change', () => {
        toggleAudioReverseLive(); // async fire-and-forget; checkIfStateChanged runs synchronously
        checkIfStateChanged();
    });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
const keysPressed = new Set();

/** Update keyboard key highlight state. Uses pre-cached kbdMap/descMap — zero live DOM queries. */
function updateKeyboardUI() {
    Object.values(kbdMap).forEach(el => el?.classList.remove('kbd-pressed', 'kbd-red-static', 'kbd-red-dim'));
    Object.values(descMap).forEach(el => el?.classList.remove('desc-highlight'));

    if (trimModal.classList.contains('hidden')) return;

    const hasShift = keysPressed.has('ShiftLeft')   || keysPressed.has('ShiftRight');
    const hasCtrl  = keysPressed.has('ControlLeft') || keysPressed.has('ControlRight');
    const hasLeft  = keysPressed.has('ArrowLeft');
    const hasRight = keysPressed.has('ArrowRight');

    if (keysPressed.has('Digit1'))    kbdMap['k-1']?.classList.add('kbd-pressed');
    if (keysPressed.has('Digit2'))    kbdMap['k-2']?.classList.add('kbd-pressed');
    if (keysPressed.has('Digit3'))    kbdMap['k-3']?.classList.add('kbd-pressed');
    if (keysPressed.has('Space'))     kbdMap['k-space']?.classList.add('kbd-pressed');
    if (keysPressed.has('ArrowUp'))   kbdMap['k-up']?.classList.add('kbd-pressed');
    if (keysPressed.has('ArrowDown')) kbdMap['k-down']?.classList.add('kbd-pressed');

    if (hasLeft || hasRight) {
        if (hasCtrl && hasShift) {
            kbdMap['k-ctrl-ms']?.classList.add('kbd-pressed');
            kbdMap['k-shift-ms']?.classList.add('kbd-pressed');
            kbdMap[hasLeft ? 'k-left-ms' : 'k-right-ms']?.classList.add('kbd-pressed');
            descMap['t-ms']?.classList.add('desc-highlight');
        } else if (hasShift) {
            kbdMap['k-shift-5']?.classList.add('kbd-pressed');
            kbdMap[hasLeft ? 'k-left-5' : 'k-right-5']?.classList.add('kbd-pressed');
            descMap['t-5s']?.classList.add('desc-highlight');
        } else if (hasCtrl) {
            kbdMap['k-ctrl-1']?.classList.add('kbd-pressed');
            kbdMap[hasLeft ? 'k-left-1' : 'k-right-1']?.classList.add('kbd-pressed');
            descMap['t-1s']?.classList.add('desc-highlight');
        } else {
            kbdMap[hasLeft ? 'k-left-10' : 'k-right-10']?.classList.add('kbd-pressed');
            descMap['t-10s']?.classList.add('desc-highlight');
        }
    } else {
        if (hasCtrl && hasShift) {
            kbdMap['k-ctrl-ms']?.classList.add('kbd-pressed');
            kbdMap['k-shift-ms']?.classList.add('kbd-pressed');
        } else if (hasShift) {
            kbdMap['k-shift-5']?.classList.add('kbd-pressed');
            kbdMap['k-shift-ms']?.classList.add('kbd-red-static');
            kbdMap['k-ctrl-ms']?.classList.add('kbd-red-dim');
        } else if (hasCtrl) {
            kbdMap['k-ctrl-1']?.classList.add('kbd-pressed');
            kbdMap['k-ctrl-ms']?.classList.add('kbd-red-static');
            kbdMap['k-shift-ms']?.classList.add('kbd-red-dim');
        }
    }
}

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    keysPressed.add(e.code);
    updateKeyboardUI();

    const isModalOpen = !trimModal.classList.contains('hidden');
    const activeWs    = (isModalOpen && wsTrim) ? wsTrim : wsGlobal;
    if (!activeWs) return;

    if (isModalOpen && e.code === 'Digit1') { e.preventDefault(); setActiveMode('left');     }
    if (isModalOpen && e.code === 'Digit2') { e.preventDefault(); setActiveMode('playhead'); }
    if (isModalOpen && e.code === 'Digit3') { e.preventDefault(); setActiveMode('right');    }

    if (e.code === 'Space') {
        e.preventDefault();
        activeWs.playPause();

    } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (isModalOpen) {
            if (!chkAdjustVol.checked) chkAdjustVol.click();
            const v = Math.min(2, parseFloat(volAdjustSlider.value) + 0.05);
            volAdjustSlider.value = v;
            lblVolAdjust.textContent = `${Math.round(v * 100)}%`;
            applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();
        } else if (!isEditedViewActive) {
            const v = Math.min(1, globalVolValue + 0.05);
            globalVolValue = v;
            volSlider.value = v;
            lblVolGlobal.textContent = `${Math.round(v * 100)}%`;
            wsGlobal.setVolume(v);
        }

    } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (isModalOpen) {
            if (!chkAdjustVol.checked) chkAdjustVol.click();
            const v = Math.max(0, parseFloat(volAdjustSlider.value) - 0.05);
            volAdjustSlider.value = v;
            lblVolAdjust.textContent = `${Math.round(v * 100)}%`;
            applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();
        } else if (!isEditedViewActive) {
            const v = Math.max(0, globalVolValue - 0.05);
            globalVolValue = v;
            volSlider.value = v;
            lblVolGlobal.textContent = `${Math.round(v * 100)}%`;
            wsGlobal.setVolume(v);
        }

    } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        const dir  = e.code === 'ArrowRight' ? 1 : -1;
        const step = (e.ctrlKey && e.shiftKey) ? 0.01 : e.shiftKey ? 5 : e.ctrlKey ? 1 : 10;

        if (isModalOpen) {
            if (activeMode === 'left' && trimRegion) {
                trimStartTime = Math.max(0, Math.min(trimStartTime + step * dir, trimEndTime - 0.01));
                trimRegion.setOptions({ start: trimStartTime });
                inpStart.value = trimStartTime.toFixed(2);
                lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
                renderVisualFades(waveformTrimContainerEl, false);
                applyLiveAudioMath(wsTrim, false);
                checkIfStateChanged();

            } else if (activeMode === 'right' && trimRegion) {
                trimEndTime = Math.min(videoDuration, Math.max(trimEndTime + step * dir, trimStartTime + 0.01));
                trimRegion.setOptions({ end: trimEndTime });
                inpEnd.value = trimEndTime.toFixed(2);
                lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
                renderVisualFades(waveformTrimContainerEl, false);
                applyLiveAudioMath(wsTrim, false);
                checkIfStateChanged();

            } else {
                const newTime = Math.max(trimStartTime, Math.min(trimEndTime,
                    Math.round((activeWs.getCurrentTime() + step * dir) * 100) / 100));
                activeWs.setTime(newTime);
                applyLiveAudioMath(wsTrim, false);
            }
        } else {
            const [lo, hi] = isEditedViewActive ? [trimStartTime, trimEndTime] : [0, videoDuration];
            const newTime  = Math.max(lo, Math.min(hi,
                Math.round((activeWs.getCurrentTime() + step * dir) * 100) / 100));
            activeWs.setTime(newTime);
            if (isEditedViewActive) applyLiveAudioMath(wsGlobal, true);
        }
    }
});

window.addEventListener('keyup',  (e) => { keysPressed.delete(e.code); updateKeyboardUI(); });
window.addEventListener('blur',   ()  => { keysPressed.clear();        updateKeyboardUI(); });

// ── Process & Download ────────────────────────────────────────────────────────
btnProcess.addEventListener('click', async () => {
    const format   = outFormat.value;
    const quality  = outQuality.value;
    const spanText = btnProcess.querySelector('span');

    btnProcess.disabled = true;
    btnProcess.classList.remove('bg-[#FF422E]', 'hover:bg-[#d43726]', 'shadow-[0_0_15px_rgba(255,66,46,0.4)]');
    btnProcess.classList.add('bg-[#1f1f1f]', 'border', 'border-[#FF422E]');

    if (currentEvtSource) currentEvtSource.close();
    currentEvtSource = new EventSource(`${API_BASE}/api/progress?client_id=${clientId}`);
    currentEvtSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        btnProcess.style.setProperty('--progress', `${data.progress}%`);
        spanText.textContent = data.msg;
        if (data.status === 'done') {
            btnProcess.classList.remove('bg-[#1f1f1f]', 'border', 'border-[#FF422E]');
            btnProcess.classList.add('bg-[#FF422E]', 'shadow-[0_0_15px_rgba(255,66,46,0.4)]');
            currentEvtSource.close();
        } else if (data.status === 'error') {
            btnProcess.classList.remove('bg-[#1f1f1f]', 'border', 'border-[#FF422E]');
            btnProcess.classList.add('bg-[#FF422E]');
            currentEvtSource.close();
        }
    };

    /** Reset the process button to its default state after a delay. */
    const resetBtn = (delay) => setTimeout(() => {
        btnProcess.disabled = false;
        btnProcess.classList.remove('bg-[#1f1f1f]', 'border', 'border-[#FF422E]');
        btnProcess.classList.add('bg-[#FF422E]', 'hover:bg-[#d43726]', 'shadow-[0_0_15px_rgba(255,66,46,0.4)]');
        spanText.textContent = 'Procesar y Descargar Audio';
        btnProcess.style.setProperty('--progress', '0%');
    }, delay);

    try {
        const res = await fetch(`${API_BASE}/api/process`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id:    clientId,
                id:           currentVideoId,
                ext:          currentExt,
                start:        trimStartTime,
                end:          trimEndTime,
                fadeIn:       parseFloat(fInG.value),
                fadeOut:      parseFloat(fOutG.value),
                format,
                quality,
                adjustVol:    chkAdjustVol.checked,
                volLevel:     parseFloat(volAdjustSlider.value),
                normalizeVol: chkNormalizeVolModal?.checked ?? false,
                tempo:        parseFloat(tempoSlider?.value ?? 1.0),
                pitch:        parseInt(pitchSlider?.value ?? 0, 10), // E2: radix
                reverse:      chkReverseAudio?.checked ?? false,
            }),
        });

        if (!res.ok) throw new Error('Error en el servidor al generar audio.');

        const blob        = await res.blob();
        const downloadUrl = URL.createObjectURL(blob);
        spanText.textContent = '¡Proceso finalizado con éxito! Descarga iniciada.';

        const a = Object.assign(document.createElement('a'), {
            href:     downloadUrl,
            download: `${metaTitle.textContent.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'audio'}_editado.${format}`,
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke Blob URL after download starts to free memory
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

        resetBtn(4000);

    } catch (err) {
        if (currentEvtSource) currentEvtSource.close();
        spanText.textContent = 'Error de conexión con el servidor Python.';
        console.error(err);
        resetBtn(4000);
    }
});

// ── Audio Reverse ─────────────────────────────────────────────────────────────

/** Encode an AudioBuffer to a WAV Blob. Inline stereo interleave avoids allocation of a temp array. */
function audioBufferToWav(buffer) {
    const numChannels    = buffer.numberOfChannels;
    const sampleRate     = buffer.sampleRate;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign     = numChannels * bytesPerSample;

    // Interleave channels inline
    const ch0    = buffer.getChannelData(0);
    const ch1    = numChannels > 1 ? buffer.getChannelData(1) : null;
    const frames = ch0.length;
    const pcm    = new Float32Array(frames * numChannels);
    for (let i = 0, j = 0; i < frames; i++) {
        pcm[j++] = ch0[i];
        if (ch1) pcm[j++] = ch1[i];
    }

    const dataBytes = pcm.length * bytesPerSample;
    const ab        = new ArrayBuffer(44 + dataBytes);
    const v         = new DataView(ab);
    const wStr      = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));

    wStr(0,  'RIFF'); v.setUint32(4,  36 + dataBytes, true);
    wStr(8,  'WAVE'); wStr(12, 'fmt ');
    v.setUint32(16, 16, true);  v.setUint16(20, 1, true);
    v.setUint16(22, numChannels, true);  v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * blockAlign, true);
    v.setUint16(32, blockAlign, true);  v.setUint16(34, 16, true);
    wStr(36, 'data'); v.setUint32(40, dataBytes, true);

    let off = 44;
    for (let i = 0; i < pcm.length; i++, off += 2) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([ab], { type: 'audio/wav' });
}

/** Fetch, reverse, and store the audio as a local Blob URL. Returns a Promise. */
async function prepareReversedAudioUrl(url) {
    try {
        const arrayBuf = await (await fetch(url)).arrayBuffer();
        const ctx      = new (window.AudioContext || window.webkitAudioContext)();
        const src      = await ctx.decodeAudioData(arrayBuf);

        const rev = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
        for (let c = 0; c < src.numberOfChannels; c++) {
            const srcData  = src.getChannelData(c);
            const destData = rev.getChannelData(c);
            const len      = srcData.length;
            for (let i = 0; i < len; i++) destData[i] = srcData[len - 1 - i];
        }

        ctx.close().catch(() => {});

        if (reversedAudioUrl) URL.revokeObjectURL(reversedAudioUrl);
        reversedAudioUrl = URL.createObjectURL(audioBufferToWav(rev));
    } catch (e) {
        console.error('Error al preparar audio invertido:', e);
    }
}

/** Swap the WaveSurfer source to the reversed (or original) audio. Awaits the preparation Promise. */
async function toggleAudioReverseLive() {
    const isReverse = chkReverseAudio?.checked ?? false;
    updateSpectrumFlipUI();

    const targetWs = wsTrim || wsGlobal;
    if (!targetWs) return;

    if (isReverse && !reversedAudioUrl) {
        const prev = lblPlayTrim ? lblPlayTrim.textContent : '';
        if (lblPlayTrim) lblPlayTrim.textContent = 'Preparando...';
        if (reversedAudioUrlPromise) await reversedAudioUrlPromise; // await instead of polling
        if (lblPlayTrim) lblPlayTrim.textContent = prev;
        if (!chkReverseAudio?.checked) return; // user unchecked while preparing
    }

    const wasPlaying = targetWs.isPlaying();
    if (wasPlaying) targetWs.pause();
    const curTime   = targetWs.getCurrentTime();
    const targetUrl = (isReverse && reversedAudioUrl) ? reversedAudioUrl : audioUrlGlobal;

    const applyReverseState = (ws, isGlobal) => {
        const newTime = Math.max(trimStartTime, Math.min(trimEndTime, (videoDuration || 1) - curTime));
        ws.setTime(newTime);
        applyLiveAudioMath(ws, isGlobal);
        if (wasPlaying) ws.play();
    };

    if (wsTrim)                    { wsTrim.once('decode',   () => applyReverseState(wsTrim,   false)); wsTrim.load(targetUrl);   }
    if (wsGlobal && isEditedViewActive) { wsGlobal.once('decode', () => applyReverseState(wsGlobal, true));  wsGlobal.load(targetUrl); }
}

// ── Tab navigation ────────────────────────────────────────────────────────────
// The tab navigation has been removed in favor of a unified CSS Grid layout.

// ── History controls ──────────────────────────────────────────────────────────
const btnClearHistory = document.getElementById('btnClearHistory');
if (btnClearHistory) btnClearHistory.addEventListener('click', clearHistory);

renderHistory();
