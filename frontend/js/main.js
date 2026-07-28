const clientId = Math.random().toString(36).substring(2, 15);
        let videoDuration = 0;
        let currentVideoId = '';
        let currentExt = '';

        let wsGlobal = null;
        let wsTrim = null;
        let trimRegion = null;
        let audioUrlGlobal = '';
        let trimStartTime = 0;
        let trimEndTime = 0;
        let currentEvtSource = null;
        
        let activeMode = 'playhead';
        let isEditedViewActive = false;
        
        let globalVolValue = 1.0;

        let lastAppliedState = {
            start: 0,
            end: 0,
            fadeIn: 0,
            fadeOut: 0,
            adjustVol: false,
            volLevel: 1.0,
            tempo: 1.0,
            normalizeVol: false,
            pitch: 0,
            reverse: false
        };

        const statusMsg = document.getElementById('statusMsg');
        const extractContainer = document.getElementById('extractContainer');
        const btnProcess = document.getElementById('btnProcess');

        const lblCurrentTime = document.getElementById('lblCurrentTime');
        const lblTotalTime = document.getElementById('lblTotalTime');

        const inpStart = document.getElementById('inpStart');
        const inpEnd = document.getElementById('inpEnd');
        const lblTrimDuration = document.getElementById('lblTrimDuration');
        const activeModeBadge = document.getElementById('activeModeBadge');

        const outFormat = document.getElementById('outFormat');
        const outQuality = document.getElementById('outQuality');
        
        const fInG = document.getElementById('fadeInGlobal');
        const fOutG = document.getElementById('fadeOutGlobal');
        const lblFadeInG = document.getElementById('lblFadeInG');
        const lblFadeOutG = document.getElementById('lblFadeOutG');

        const chkAdjustVol = document.getElementById('chkAdjustVol');
        const volAdjustSlider = document.getElementById('volAdjustSlider');
        const lblVolAdjust = document.getElementById('lblVolAdjust');
        
        const viewToggle = document.getElementById('viewToggle');
        const btnViewOriginal = document.getElementById('btnViewOriginal');
        const btnViewEdited = document.getElementById('btnViewEdited');
        const volSlider = document.getElementById('volSlider');
        const lblVolGlobal = document.getElementById('lblVolGlobal');
        const btnApplyTrim = document.getElementById('btnApplyTrim');

        const HISTORY_KEY = 'rak_audio_history';

        function loadHistory() {
            try {
                return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
            } catch (e) {
                return [];
            }
        }

        function saveToHistory(item) {
            let list = loadHistory();
            list = list.filter(i => i.id !== item.id);
            list.unshift(item);
            if (list.length > 10) list = list.slice(0, 10);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
            renderHistory();
        }

        function clearHistory() {
            localStorage.removeItem(HISTORY_KEY);
            renderHistory();
        }

        function renderHistory() {
            const historySection = document.getElementById('historySection');
            const historyList = document.getElementById('historyList');
            if (!historySection || !historyList) return;

            const list = loadHistory();
            if (list.length === 0) {
                historySection.classList.add('hidden');
                historyList.innerHTML = '';
                return;
            }

            historySection.classList.remove('hidden');
            historyList.innerHTML = list.map(item => `
                <div class="bg-[#1f1f1f] p-3 rounded-lg border border-[#444] flex items-center gap-3 hover:border-[#FF422E] transition group">
                    <img src="${item.thumbnailUrl}" alt="Portada" class="w-20 h-14 object-cover rounded border border-[#333]">
                    <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-bold text-white truncate group-hover:text-[#FF422E] transition">${item.title || 'Sin título'}</h4>
                        <p class="text-xs text-gray-400 truncate">${item.uploader || 'Desconocido'} • ${formatTime(item.duration)}</p>
                    </div>
                    <button data-url="${item.url}" class="btn-reload-history bg-[#FF422E] hover:bg-[#d43726] px-3 py-1.5 rounded text-xs font-bold text-white transition flex-shrink-0">
                        Cargar
                    </button>
                </div>
            `).join('');

            historyList.querySelectorAll('.btn-reload-history').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetUrl = e.currentTarget.getAttribute('data-url');
                    if (targetUrl) {
                        document.getElementById('ytUrl').value = targetUrl;
                        document.getElementById('btnExtraer').click();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                });
            });
        }

        const hoverOptions = {
            lineColor: '#FF422E',
            lineWidth: 2,
            labelBackground: '#FF422E',
            labelColor: '#fff',
            labelSize: '11px',
        };

        const formatTime = (seconds) => {
            if (isNaN(seconds) || seconds < 0) return "0:00";
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };

        function checkIfStateChanged() {
            if (!btnApplyTrim) return;

            const currentStart = parseFloat(trimStartTime.toFixed(2));
            const currentEnd = parseFloat(trimEndTime.toFixed(2));
            const currentFadeIn = parseFloat(parseFloat(fInG.value).toFixed(2)) || 0;
            const currentFadeOut = parseFloat(parseFloat(fOutG.value).toFixed(2)) || 0;
            const currentAdjVol = chkAdjustVol.checked;
            const currentVolLvl = parseFloat(parseFloat(volAdjustSlider.value).toFixed(2));

            const currentTempo = parseFloat(parseFloat(document.getElementById('tempoSlider')?.value || 1.0).toFixed(2));
            const currentNorm = document.getElementById('chkNormalizeVolModal')?.checked || false;
            const currentPitch = parseInt(document.getElementById('pitchSlider')?.value || 0);
            const currentRev = document.getElementById('chkReverseAudio')?.checked || false;

            const isSame = 
                Math.abs(currentStart - lastAppliedState.start) < 0.01 &&
                Math.abs(currentEnd - lastAppliedState.end) < 0.01 &&
                Math.abs(currentFadeIn - lastAppliedState.fadeIn) < 0.01 &&
                Math.abs(currentFadeOut - lastAppliedState.fadeOut) < 0.01 &&
                currentAdjVol === lastAppliedState.adjustVol &&
                (!currentAdjVol || Math.abs(currentVolLvl - lastAppliedState.volLevel) < 0.01) &&
                Math.abs(currentTempo - (lastAppliedState.tempo || 1.0)) < 0.01 &&
                currentNorm === (lastAppliedState.normalizeVol || false) &&
                currentPitch === (lastAppliedState.pitch || 0) &&
                currentRev === (lastAppliedState.reverse || false);

            if (isSame) {
                btnApplyTrim.disabled = true;
                btnApplyTrim.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
                btnApplyTrim.classList.remove('hover:bg-[#d43726]');
            } else {
                btnApplyTrim.disabled = false;
                btnApplyTrim.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
                btnApplyTrim.classList.add('hover:bg-[#d43726]');
            }
        }

        function updateTimeDisplay() {
            if (!wsGlobal) return;
            const cur = wsGlobal.getCurrentTime();
            if (isEditedViewActive) {
                const relativeCur = Math.max(0, cur - trimStartTime);
                const trimmedDuration = Math.max(0, trimEndTime - trimStartTime);
                lblCurrentTime.textContent = formatTime(relativeCur);
                lblTotalTime.textContent = formatTime(trimmedDuration);
            } else {
                lblCurrentTime.textContent = formatTime(cur);
                lblTotalTime.textContent = formatTime(videoDuration);
            }
        }

        let originalAudioBuffer = null;

        function getReversedAudioBuffer(audioBuffer) {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const numChannels = audioBuffer.numberOfChannels;
                const length = audioBuffer.length;
                const sampleRate = audioBuffer.sampleRate;
                const reversed = ctx.createBuffer(numChannels, length, sampleRate);
                
                for (let c = 0; c < numChannels; c++) {
                    const src = audioBuffer.getChannelData(c);
                    const dest = reversed.getChannelData(c);
                    for (let i = 0; i < length; i++) {
                        dest[i] = src[length - 1 - i];
                    }
                }
                return reversed;
            } catch (e) {
                console.error("Error al crear buffer invertido:", e);
                return null;
            }
        }

        function applyLiveAudioMath(ws, isGlobalEdited) {
            if (!ws) return;
            let currentTime = ws.getCurrentTime();
            let start = isGlobalEdited ? trimStartTime : (ws === wsTrim ? trimStartTime : 0);
            let end = isGlobalEdited ? trimEndTime : (ws === wsTrim ? trimEndTime : videoDuration);
            let t = currentTime - start;
            
            let inSec = parseFloat(fInG.value);
            let outSec = parseFloat(fOutG.value);
            
            let maxVol;
            if (ws === wsTrim || isGlobalEdited) {
                maxVol = chkAdjustVol.checked ? parseFloat(volAdjustSlider.value) : globalVolValue;
            } else {
                maxVol = globalVolValue;
            }

            // Normalización de volumen EBU R128 en vivo (+3.5dB de ganancia)
            const isNormalize = document.getElementById('chkNormalizeVolModal')?.checked || false;
            if (isNormalize && (ws === wsTrim || isGlobalEdited)) {
                maxVol *= 1.45;
            }

            let currentVol = maxVol;

            if (inSec > 0 && t < inSec && t >= 0) {
                currentVol = maxVol * (t / inSec);
            } else if (outSec > 0 && currentTime > (end - outSec) && currentTime <= end) {
                let timeLeft = end - currentTime;
                currentVol = maxVol * (timeLeft / outSec);
            }

            currentVol = Math.max(0, Math.min(2.0, currentVol));
            ws.setVolume(currentVol);

            // Velocidad (Tempo) y Tono (Pitch) en vivo
            const tempoVal = parseFloat(document.getElementById('tempoSlider')?.value || 1.0);
            const pitchVal = parseInt(document.getElementById('pitchSlider')?.value || 0);

            const pitchFactor = Math.pow(2, pitchVal / 12);
            const effectiveRate = Math.max(0.25, Math.min(4.0, tempoVal * pitchFactor));
            const preservePitch = (pitchVal === 0);

            try {
                ws.setPlaybackRate(effectiveRate, preservePitch);
            } catch (e) {
                // Fallback si la tasa excede límites del navegador
            }
        }

        chkAdjustVol.addEventListener('change', (e) => {
            volAdjustSlider.disabled = !e.target.checked;
            if(e.target.checked) {
                volAdjustSlider.classList.remove('opacity-50', 'pointer-events-none');
                lblVolAdjust.classList.remove('opacity-50');
            } else {
                volAdjustSlider.classList.add('opacity-50', 'pointer-events-none');
                lblVolAdjust.classList.add('opacity-50');
            }
            if(wsTrim) applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();
        });

        volAdjustSlider.addEventListener('input', (e) => {
            lblVolAdjust.textContent = `${Math.round(e.target.value * 100)}%`;
            if (chkAdjustVol.checked && wsTrim) applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();
        });

        inpStart.addEventListener('input', () => checkIfStateChanged());
        inpStart.addEventListener('change', (e) => {
            let val = parseFloat(e.target.value) || 0;
            if(val < 0) val = 0;
            if(val >= trimEndTime - 0.01) val = trimEndTime - 0.01;
            
            trimStartTime = val;
            e.target.value = trimStartTime.toFixed(2);
            
            if (trimRegion) {
                trimRegion.setOptions({ start: trimStartTime });
            }
            
            lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
            renderVisualFades('waveformTrimContainer', false);
            if (wsTrim) applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();
        });

        inpEnd.addEventListener('input', () => checkIfStateChanged());
        inpEnd.addEventListener('change', (e) => {
            let val = parseFloat(e.target.value) || 0;
            if(val > videoDuration) val = videoDuration;
            if(val <= trimStartTime + 0.01) val = trimStartTime + 0.01;
            
            trimEndTime = val;
            e.target.value = trimEndTime.toFixed(2);
            
            if (trimRegion) {
                trimRegion.setOptions({ end: trimEndTime });
            }
            
            lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
            renderVisualFades('waveformTrimContainer', false);
            if (wsTrim) applyLiveAudioMath(wsTrim, false);
            checkIfStateChanged();
        });

        function renderVisualFades(containerId, isGlobalEdited) {
            const container = document.getElementById(containerId);
            const dur = videoDuration || 1;
            const startP = (trimStartTime / dur) * 100;
            const endP = (trimEndTime / dur) * 100;
            const inSec = parseFloat(fInG.value);
            const outSec = parseFloat(fOutG.value);

            if (isGlobalEdited) {
                container.querySelectorAll('.visual-fx').forEach(el => el.remove());
                const bLeft = document.createElement('div');
                bLeft.className = 'visual-fx blackout-overlay';
                bLeft.style.width = `${startP}%`;
                bLeft.style.left = '0';
                
                const bRight = document.createElement('div');
                bRight.className = 'visual-fx blackout-overlay';
                bRight.style.width = `${100 - endP}%`;
                bRight.style.right = '0';
                
                container.appendChild(bLeft);
                container.appendChild(bRight);

                const lineLeft = document.createElement('div');
                lineLeft.className = 'visual-fx fade-overlay';
                lineLeft.style.left = `${startP}%`;
                lineLeft.style.width = '2px';
                lineLeft.style.backgroundColor = '#FF422E';
                lineLeft.style.boxShadow = '0 0 6px #FF422E';
                lineLeft.style.zIndex = '15';

                const lineRight = document.createElement('div');
                lineRight.className = 'visual-fx fade-overlay';
                lineRight.style.left = `${endP}%`;
                lineRight.style.width = '2px';
                lineRight.style.backgroundColor = '#FF422E';
                lineRight.style.boxShadow = '0 0 6px #FF422E';
                lineRight.style.zIndex = '15';

                container.appendChild(lineLeft);
                container.appendChild(lineRight);

                if (inSec > 0) {
                    const fInDiv = document.createElement('div');
                    fInDiv.className = 'visual-fx fade-overlay fade-in-gradient';
                    fInDiv.style.left = `${startP}%`;
                    fInDiv.style.width = `${(inSec / dur) * 100}%`;
                    container.appendChild(fInDiv);
                }

                if (outSec > 0) {
                    const fOutDiv = document.createElement('div');
                    fOutDiv.className = 'visual-fx fade-overlay fade-out-gradient';
                    fOutDiv.style.left = `${((trimEndTime - outSec) / dur) * 100}%`;
                    fOutDiv.style.width = `${(outSec / dur) * 100}%`;
                    container.appendChild(fOutDiv);
                }
            } else {
                const regionDur = (trimEndTime - trimStartTime) || 1;
                const inPerc = Math.min(100, (inSec / regionDur) * 100);
                const outPerc = Math.min(100, (outSec / regionDur) * 100);
                document.getElementById('waveformTrim').style.setProperty('--fade-in-width', `${inPerc}%`);
                document.getElementById('waveformTrim').style.setProperty('--fade-out-width', `${outPerc}%`);
            }
        }

        fInG.addEventListener('input', () => {
            lblFadeInG.textContent = `${fInG.value}s`;
            if(wsTrim) {
                renderVisualFades('waveformTrimContainer', false);
                applyLiveAudioMath(wsTrim, false);
            }
            if(isEditedViewActive && wsGlobal) {
                renderVisualFades('waveformContainer', true);
                applyLiveAudioMath(wsGlobal, true);
            }
            checkIfStateChanged();
        });

        fOutG.addEventListener('input', () => {
            lblFadeOutG.textContent = `${fOutG.value}s`;
            if(wsTrim) {
                renderVisualFades('waveformTrimContainer', false);
                applyLiveAudioMath(wsTrim, false);
            }
            if(isEditedViewActive && wsGlobal) {
                renderVisualFades('waveformContainer', true);
                applyLiveAudioMath(wsGlobal, true);
            }
            checkIfStateChanged();
        });

        function setGlobalView(edited) {
            isEditedViewActive = edited;
            if(edited) {
                btnViewEdited.classList.replace('text-gray-400', 'text-white');
                btnViewEdited.classList.replace('hover:text-white', 'bg-[#FF422E]');
                btnViewOriginal.classList.replace('bg-[#FF422E]', 'hover:text-white');
                btnViewOriginal.classList.replace('text-white', 'text-gray-400');
                
                volSlider.disabled = true;
                volSlider.classList.add('opacity-50', 'cursor-not-allowed');
                
                const editVol = chkAdjustVol.checked ? parseFloat(volAdjustSlider.value) : globalVolValue;
                volSlider.max = "2"; 
                volSlider.value = editVol;
                lblVolGlobal.textContent = `${Math.round(editVol * 100)}%`;
                
                renderVisualFades('waveformContainer', true);
                if (wsGlobal) wsGlobal.setTime(trimStartTime);
            } else {
                btnViewOriginal.classList.replace('text-gray-400', 'text-white');
                btnViewOriginal.classList.replace('hover:text-white', 'bg-[#FF422E]');
                btnViewEdited.classList.replace('bg-[#FF422E]', 'hover:text-white');
                btnViewEdited.classList.replace('text-white', 'text-gray-400');
                
                volSlider.disabled = false;
                volSlider.classList.remove('opacity-50', 'cursor-not-allowed');
                
                volSlider.max = "1";
                volSlider.value = globalVolValue;
                lblVolGlobal.textContent = `${Math.round(globalVolValue * 100)}%`;
                if (wsGlobal) wsGlobal.setVolume(globalVolValue);
                
                document.getElementById('waveformContainer').querySelectorAll('.visual-fx').forEach(el => el.remove());
            }
            updateSpectrumFlipUI();
            updateTimeDisplay();
        }

        btnViewOriginal.addEventListener('click', () => setGlobalView(false));
        btnViewEdited.addEventListener('click', () => setGlobalView(true));

        function setActiveMode(mode) {
            activeMode = mode;
            if (!activeModeBadge) return;
            
            if (mode === 'left') {
                activeModeBadge.textContent = 'Ajuste Límite Izquierdo (1)';
                activeModeBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FF422E] text-white transition-all shadow-[0_0_8px_rgba(255,66,46,0.6)]';
            } else if (mode === 'right') {
                activeModeBadge.textContent = 'Ajuste Límite Derecho (3)';
                activeModeBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FF422E] text-white transition-all shadow-[0_0_8px_rgba(255,66,46,0.6)]';
            } else {
                activeModeBadge.textContent = 'Moviendo Cabezal (2)';
                activeModeBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#444444] text-white transition-all shadow-[0_0_8px_rgba(255,255,255,0.2)]';
            }
        }

        outFormat.addEventListener('change', (e) => {
            if (e.target.value === 'wav') {
                outQuality.disabled = true;
                outQuality.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                outQuality.disabled = false;
                outQuality.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        });
        outFormat.dispatchEvent(new Event('change'));

        const showStatus = (msg, isError = false) => {
            statusMsg.textContent = msg;
            statusMsg.classList.remove('hidden');
            statusMsg.className = `text-sm mt-2 block z-10 font-mono text-white ${isError ? 'font-bold text-[#FF422E]' : ''}`;
        };

        const initWaveSurfer = () => {
            if (wsGlobal) wsGlobal.destroy();
            wsGlobal = WaveSurfer.create({
                container: '#waveform',
                waveColor: '#777777',
                progressColor: '#FF422E',
                cursorColor: '#ffffff',
                barWidth: 2,
                barRadius: 2,
                height: 96,
                url: audioUrlGlobal,
                plugins: [WaveSurfer.Hover.create(hoverOptions)]
            });

            wsGlobal.on('play', () => document.getElementById('btnPlayPause').textContent = 'Pause');
            wsGlobal.on('pause', () => document.getElementById('btnPlayPause').textContent = 'Play');

            wsGlobal.on('ready', () => {
                updateTimeDisplay();
                wsGlobal.setVolume(globalVolValue);
            });
            wsGlobal.on('audioprocess', () => {
                updateTimeDisplay();
                if(isEditedViewActive) {
                    if(wsGlobal.getCurrentTime() >= trimEndTime) {
                        wsGlobal.pause();
                        wsGlobal.setTime(trimStartTime);
                    } else {
                        applyLiveAudioMath(wsGlobal, true);
                    }
                } else {
                    wsGlobal.setVolume(globalVolValue);
                }
            });
            wsGlobal.on('interaction', () => {
                if(isEditedViewActive) {
                    if (wsGlobal.getCurrentTime() < trimStartTime || wsGlobal.getCurrentTime() > trimEndTime) {
                        wsGlobal.setTime(trimStartTime);
                    }
                    applyLiveAudioMath(wsGlobal, true);
                }
                updateTimeDisplay();
            });
        };

        document.getElementById('btnPlayPause').addEventListener('click', () => {
            if(isEditedViewActive && wsGlobal.getCurrentTime() < trimStartTime) wsGlobal.setTime(trimStartTime);
            wsGlobal.playPause();
        });
        
        document.getElementById('btnStart').addEventListener('click', () => wsGlobal.seekTo(isEditedViewActive ? (trimStartTime/videoDuration) : 0));
        document.getElementById('btnEnd').addEventListener('click', () => wsGlobal.seekTo(isEditedViewActive ? (trimEndTime/videoDuration) : 1));
        document.getElementById('btnMinus10').addEventListener('click', () => wsGlobal.skip(-10));
        document.getElementById('btnMinus5').addEventListener('click', () => wsGlobal.skip(-5));
        document.getElementById('btnPlus5').addEventListener('click', () => wsGlobal.skip(5));
        document.getElementById('btnPlus10').addEventListener('click', () => wsGlobal.skip(10));

        volSlider.addEventListener('input', (e) => {
            if(!isEditedViewActive) {
                globalVolValue = Number(e.target.value);
                lblVolGlobal.textContent = `${Math.round(globalVolValue * 100)}%`;
                if(wsGlobal) wsGlobal.setVolume(globalVolValue);
            }
        });

        document.getElementById('btnExtraer').addEventListener('click', async () => {
            const url = document.getElementById('ytUrl').value;
            if (!url.includes('youtu')) return showStatus('Enlace no válido.', true);

            if (currentEvtSource) currentEvtSource.close();
            viewToggle.classList.add('hidden');
            setGlobalView(false); 

            if (wsTrim) { wsTrim.destroy(); wsTrim = null; }

            currentEvtSource = new EventSource(`http://localhost:5050/api/progress?client_id=${clientId}`);
            currentEvtSource.onmessage = (e) => {
                const data = JSON.parse(e.data);
                extractContainer.style.setProperty('--progress', `${data.progress}%`);
                showStatus(data.msg);
                if (data.status === 'done' || data.status === 'error') currentEvtSource.close();
            };

            try {
                const res = await fetch('http://localhost:5050/api/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url, client_id: clientId })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                currentVideoId = data.id;
                currentExt = data.ext;
                audioUrlGlobal = data.audioUrl;
                prepareReversedAudioUrl(data.audioUrl);

                document.getElementById('metaTitle').textContent = data.title;
                document.getElementById('metaChannel').textContent = data.uploader;
                document.getElementById('metaViews').textContent = parseInt(data.views).toLocaleString();
                document.getElementById('metaDate').textContent = data.uploadDate;
                document.getElementById('metaThumb').src = data.thumbnailUrl;
                document.getElementById('metaDuration').textContent = formatTime(data.duration);

                videoDuration = data.duration;
                trimStartTime = 0;
                trimEndTime = videoDuration;

                lastAppliedState = {
                    start: 0,
                    end: parseFloat(videoDuration.toFixed(2)),
                    fadeIn: 0,
                    fadeOut: 0,
                    adjustVol: false,
                    volLevel: 1.0
                };

                document.getElementById('metadataSection').classList.remove('hidden');
                document.getElementById('editorSection').classList.remove('hidden');
                document.getElementById('downloadSection').classList.remove('hidden');

                saveToHistory({
                    id: data.id,
                    title: data.title,
                    uploader: data.uploader,
                    uploadDate: data.uploadDate,
                    thumbnailUrl: data.thumbnailUrl,
                    duration: data.duration,
                    url: url
                });

                initWaveSurfer();

                setTimeout(() => { extractContainer.style.setProperty('--progress', '0%'); }, 2000);

            } catch (err) {
                if (currentEvtSource) currentEvtSource.close();
                extractContainer.style.setProperty('--progress', '0%');
                showStatus(`Error de conexión con el servidor Python.`, true);
                console.error(err);
            }
        });

        document.getElementById('btnOpenTrim').addEventListener('click', () => {
            document.getElementById('trimModal').classList.remove('hidden');
            setActiveMode('playhead'); 
            
            if (wsGlobal && wsGlobal.isPlaying()) wsGlobal.pause();

            if (!wsTrim) {
                const wsRegions = WaveSurfer.Regions.create();
                wsTrim = WaveSurfer.create({
                    container: '#waveformTrim',
                    waveColor: '#777777',
                    progressColor: '#FF422E',
                    cursorColor: '#ffffff',
                    height: 176,
                    url: audioUrlGlobal,
                    dragToSeek: true,
                    plugins: [
                        wsRegions,
                        WaveSurfer.Hover.create(hoverOptions)
                    ]
                });

                wsTrim.on('play', () => {
                    const lbl = document.getElementById('lblPlayTrim');
                    if (lbl) lbl.textContent = 'Pausar Selección';
                });

                wsTrim.on('pause', () => {
                    const lbl = document.getElementById('lblPlayTrim');
                    if (lbl) lbl.textContent = 'Escuchar Selección';
                    const btnTrim = document.getElementById('btnPlayTrim');
                    if (btnTrim) btnTrim.style.setProperty('--trim-progress', '0%');
                });

                wsTrim.on('decode', () => {
                    trimRegion = wsRegions.addRegion({
                        start: trimStartTime,
                        end: trimEndTime,
                        color: 'rgba(255, 66, 46, 0.3)',
                        drag: false,
                        resize: true
                    });

                    inpStart.value = trimStartTime.toFixed(2);
                    inpEnd.value = trimEndTime.toFixed(2);
                    lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
                    
                    renderVisualFades('waveformTrimContainer', false);
                    applyLiveAudioMath(wsTrim, false);
                    checkIfStateChanged();

                    trimRegion.on('update', () => {
                        let curStart = trimRegion.start;
                        let curEnd = trimRegion.end;
                        const snapThreshold = 0.35;

                        if (Math.abs(curStart - lastAppliedState.start) < snapThreshold) {
                            curStart = lastAppliedState.start;
                            trimRegion.setOptions({ start: curStart });
                        } else if (Math.abs(curStart - 0) < snapThreshold) {
                            curStart = 0;
                            trimRegion.setOptions({ start: curStart });
                        }

                        if (Math.abs(curEnd - lastAppliedState.end) < snapThreshold) {
                            curEnd = lastAppliedState.end;
                            trimRegion.setOptions({ end: curEnd });
                        } else if (Math.abs(curEnd - videoDuration) < snapThreshold) {
                            curEnd = videoDuration;
                            trimRegion.setOptions({ end: curEnd });
                        }

                        if (curStart !== trimStartTime && curEnd === trimEndTime) {
                            setActiveMode('left');
                        } else if (curEnd !== trimEndTime && curStart === trimStartTime) {
                            setActiveMode('right');
                        }

                        trimStartTime = curStart;
                        trimEndTime = curEnd;
                        
                        inpStart.value = trimStartTime.toFixed(2);
                        inpEnd.value = trimEndTime.toFixed(2);
                        lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
                        
                        renderVisualFades('waveformTrimContainer', false);
                        applyLiveAudioMath(wsTrim, false);
                        checkIfStateChanged();
                    });

                    trimRegion.on('update-end', () => {
                        checkIfStateChanged();
                    });
                });

                wsTrim.on('interaction', () => {
                    setActiveMode('playhead');
                    if (wsTrim.getCurrentTime() < trimStartTime || wsTrim.getCurrentTime() > trimEndTime) {
                        wsTrim.setTime(trimStartTime);
                    }
                    applyLiveAudioMath(wsTrim, false);
                });

                const updateTrimProgressUI = () => {
                    if (!wsTrim) return;
                    const btnTrim = document.getElementById('btnPlayTrim');
                    if (!btnTrim) return;

                    if (wsTrim.getCurrentTime() >= trimEndTime) {
                        wsTrim.pause();
                        wsTrim.setTime(trimStartTime);
                        btnTrim.style.setProperty('--trim-progress', '0%');
                    } else {
                        applyLiveAudioMath(wsTrim, false);
                        const duration = trimEndTime - trimStartTime;
                        if (duration > 0 && wsTrim.isPlaying()) {
                            const elapsed = wsTrim.getCurrentTime() - trimStartTime;
                            const percent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
                            btnTrim.style.setProperty('--trim-progress', `${percent.toFixed(1)}%`);
                        }
                    }
                };

                wsTrim.on('audioprocess', updateTrimProgressUI);
                wsTrim.on('timeupdate', updateTrimProgressUI);
            } else {
                applyLiveAudioMath(wsTrim, false);
                checkIfStateChanged();
            }
        });

        document.getElementById('btnCloseTrim').addEventListener('click', () => {
            if (wsTrim && wsTrim.isPlaying()) wsTrim.pause();
            document.getElementById('trimModal').classList.add('hidden');
        });

        btnApplyTrim.addEventListener('click', () => {
            if (btnApplyTrim.disabled) return;
            if (wsTrim && wsTrim.isPlaying()) wsTrim.pause();
            
            lastAppliedState = {
                start: parseFloat(trimStartTime.toFixed(2)),
                end: parseFloat(trimEndTime.toFixed(2)),
                fadeIn: parseFloat(parseFloat(fInG.value).toFixed(2)) || 0,
                fadeOut: parseFloat(parseFloat(fOutG.value).toFixed(2)) || 0,
                adjustVol: chkAdjustVol.checked,
                volLevel: parseFloat(parseFloat(volAdjustSlider.value).toFixed(2))
            };

            document.getElementById('trimModal').classList.add('hidden');
            
            viewToggle.classList.remove('hidden');
            setGlobalView(true);
            checkIfStateChanged();
        });

        document.getElementById('btnPlayTrim').addEventListener('click', () => {
            if (wsTrim.isPlaying()) {
                wsTrim.pause();
            } else {
                if (wsTrim.getCurrentTime() < trimStartTime || wsTrim.getCurrentTime() > trimEndTime) {
                    wsTrim.setTime(trimStartTime);
                }
                wsTrim.play();
            }
        });

        const keysPressed = new Set();

        function updateKeyboardUI() {
            document.querySelectorAll('kbd').forEach(k => {
                k.classList.remove('kbd-pressed', 'kbd-red-static', 'kbd-red-dim');
            });
            document.querySelectorAll('.desc-text').forEach(t => t.classList.remove('desc-highlight'));

            const isModalOpen = !document.getElementById('trimModal').classList.contains('hidden');
            if (!isModalOpen) return; 

            const hasShift = keysPressed.has('ShiftLeft') || keysPressed.has('ShiftRight');
            const hasCtrl = keysPressed.has('ControlLeft') || keysPressed.has('ControlRight');
            const hasLeft = keysPressed.has('ArrowLeft');
            const hasRight = keysPressed.has('ArrowRight');

            if (keysPressed.has('Digit1')) document.getElementById('k-1')?.classList.add('kbd-pressed');
            if (keysPressed.has('Digit2')) document.getElementById('k-2')?.classList.add('kbd-pressed');
            if (keysPressed.has('Digit3')) document.getElementById('k-3')?.classList.add('kbd-pressed');
            if (keysPressed.has('Space')) document.getElementById('k-space')?.classList.add('kbd-pressed');
            if (keysPressed.has('ArrowUp')) document.getElementById('k-up')?.classList.add('kbd-pressed');
            if (keysPressed.has('ArrowDown')) document.getElementById('k-down')?.classList.add('kbd-pressed');

            if (hasLeft || hasRight) {
                if (hasCtrl && hasShift) {
                    document.getElementById('k-ctrl-ms')?.classList.add('kbd-pressed');
                    document.getElementById('k-shift-ms')?.classList.add('kbd-pressed');
                    document.getElementById(hasLeft ? 'k-left-ms' : 'k-right-ms')?.classList.add('kbd-pressed');
                    document.getElementById('t-ms')?.classList.add('desc-highlight');
                } else if (hasShift) {
                    document.getElementById('k-shift-5')?.classList.add('kbd-pressed');
                    document.getElementById(hasLeft ? 'k-left-5' : 'k-right-5')?.classList.add('kbd-pressed');
                    document.getElementById('t-5s')?.classList.add('desc-highlight');
                } else if (hasCtrl) {
                    document.getElementById('k-ctrl-1')?.classList.add('kbd-pressed');
                    document.getElementById(hasLeft ? 'k-left-1' : 'k-right-1')?.classList.add('kbd-pressed');
                    document.getElementById('t-1s')?.classList.add('desc-highlight');
                } else {
                    document.getElementById(hasLeft ? 'k-left-10' : 'k-right-10')?.classList.add('kbd-pressed');
                    document.getElementById('t-10s')?.classList.add('desc-highlight');
                }
            } else {
                if (hasCtrl && hasShift) {
                    document.getElementById('k-ctrl-ms')?.classList.add('kbd-pressed');
                    document.getElementById('k-shift-ms')?.classList.add('kbd-pressed');
                } else if (hasShift) {
                    document.getElementById('k-shift-5')?.classList.add('kbd-pressed');
                    document.getElementById('k-shift-ms')?.classList.add('kbd-red-static');
                    document.getElementById('k-ctrl-ms')?.classList.add('kbd-red-dim');
                } else if (hasCtrl) {
                    document.getElementById('k-ctrl-1')?.classList.add('kbd-pressed');
                    document.getElementById('k-ctrl-ms')?.classList.add('kbd-red-static');
                    document.getElementById('k-shift-ms')?.classList.add('kbd-red-dim');
                }
            }
        }

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            keysPressed.add(e.code);
            updateKeyboardUI();

            const isModalOpen = !document.getElementById('trimModal').classList.contains('hidden');
            const activeWs = (isModalOpen && wsTrim) ? wsTrim : wsGlobal;
            if (!activeWs) return;

            if (isModalOpen && e.code === 'Digit1') { e.preventDefault(); setActiveMode('left'); }
            if (isModalOpen && e.code === 'Digit2') { e.preventDefault(); setActiveMode('playhead'); }
            if (isModalOpen && e.code === 'Digit3') { e.preventDefault(); setActiveMode('right'); }

            if (e.code === 'Space') {
                e.preventDefault(); 
                activeWs.playPause();
            } 
            else if (e.code === 'ArrowUp') {
                e.preventDefault();
                if(isModalOpen) {
                    if(!chkAdjustVol.checked) chkAdjustVol.click();
                    let v = Math.min(2, parseFloat(volAdjustSlider.value) + 0.05);
                    volAdjustSlider.value = v;
                    lblVolAdjust.textContent = `${Math.round(v * 100)}%`;
                    applyLiveAudioMath(wsTrim, false);
                    checkIfStateChanged();
                } else {
                    if(!isEditedViewActive) {
                        let v = Math.min(1, globalVolValue + 0.05);
                        globalVolValue = v;
                        volSlider.value = v;
                        lblVolGlobal.textContent = `${Math.round(v * 100)}%`;
                        wsGlobal.setVolume(v);
                    }
                }
            } 
            else if (e.code === 'ArrowDown') {
                e.preventDefault();
                if(isModalOpen) {
                    if(!chkAdjustVol.checked) chkAdjustVol.click();
                    let v = Math.max(0, parseFloat(volAdjustSlider.value) - 0.05);
                    volAdjustSlider.value = v;
                    lblVolAdjust.textContent = `${Math.round(v * 100)}%`;
                    applyLiveAudioMath(wsTrim, false);
                    checkIfStateChanged();
                } else {
                    if(!isEditedViewActive) {
                        let v = Math.max(0, globalVolValue - 0.05);
                        globalVolValue = v;
                        volSlider.value = v;
                        lblVolGlobal.textContent = `${Math.round(v * 100)}%`;
                        wsGlobal.setVolume(v);
                    }
                }
            } 
            else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
                e.preventDefault();
                const direction = e.code === 'ArrowRight' ? 1 : -1;
                
                let step = 10; 
                if (e.ctrlKey && e.shiftKey) step = 0.01;
                else if (e.shiftKey) step = 5;             
                else if (e.ctrlKey) step = 1;              

                if (isModalOpen) {
                    if (activeMode === 'left' && trimRegion) {
                        let newStart = trimStartTime + (step * direction);
                        if (newStart < 0) newStart = 0;
                        if (newStart >= trimEndTime - 0.01) newStart = trimEndTime - 0.01; 
                        
                        trimRegion.setOptions({ start: newStart });
                        trimStartTime = newStart;
                        inpStart.value = trimStartTime.toFixed(2);
                        lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
                        renderVisualFades('waveformTrimContainer', false);
                        applyLiveAudioMath(wsTrim, false);
                        checkIfStateChanged();
                    } 
                    else if (activeMode === 'right' && trimRegion) {
                        let newEnd = trimEndTime + (step * direction);
                        if (newEnd > videoDuration) newEnd = videoDuration;
                        if (newEnd <= trimStartTime + 0.01) newEnd = trimStartTime + 0.01;
                        
                        trimRegion.setOptions({ end: newEnd });
                        trimEndTime = newEnd;
                        inpEnd.value = trimEndTime.toFixed(2);
                        lblTrimDuration.textContent = (trimEndTime - trimStartTime).toFixed(2);
                        renderVisualFades('waveformTrimContainer', false);
                        applyLiveAudioMath(wsTrim, false);
                        checkIfStateChanged();
                    } 
                    else {
                        let current = activeWs.getCurrentTime();
                        let newTime = Math.round((current + (step * direction)) * 100) / 100;
                        if (newTime < trimStartTime) newTime = trimStartTime;
                        if (newTime > trimEndTime) newTime = trimEndTime;
                        activeWs.setTime(newTime);
                        applyLiveAudioMath(wsTrim, false);
                    }
                } 
                else {
                    let current = activeWs.getCurrentTime();
                    let newTime = Math.round((current + (step * direction)) * 100) / 100;
                    if(isEditedViewActive) {
                        if (newTime < trimStartTime) newTime = trimStartTime;
                        if (newTime > trimEndTime) newTime = trimEndTime;
                    } else {
                        if (newTime < 0) newTime = 0;
                        if (newTime > videoDuration) newTime = videoDuration;
                    }
                    activeWs.setTime(newTime);
                    if(isEditedViewActive) applyLiveAudioMath(wsGlobal, true);
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            keysPressed.delete(e.code);
            updateKeyboardUI();
        });

        window.addEventListener('blur', () => {
            keysPressed.clear();
            updateKeyboardUI();
        });

        btnProcess.addEventListener('click', async () => {
            const format = document.getElementById('outFormat').value;
            const quality = document.getElementById('outQuality').value;
            const spanText = btnProcess.querySelector('span');

            btnProcess.disabled = true;
            btnProcess.classList.remove('bg-[#FF422E]', 'hover:bg-[#d43726]', 'shadow-[0_0_15px_rgba(255,66,46,0.4)]');
            btnProcess.classList.add('bg-[#1f1f1f]', 'border', 'border-[#FF422E]');

            if (currentEvtSource) currentEvtSource.close();
            currentEvtSource = new EventSource(`http://localhost:5050/api/progress?client_id=${clientId}`);

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

            try {
                const res = await fetch('http://localhost:5050/api/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: clientId,
                        id: currentVideoId,
                        ext: currentExt,
                        start: trimStartTime,
                        end: trimEndTime,
                        fadeIn: parseFloat(fInG.value),
                        fadeOut: parseFloat(fOutG.value),
                        format: format,
                        quality: quality,
                        adjustVol: chkAdjustVol.checked,
                        volLevel: parseFloat(volAdjustSlider.value),
                        normalizeVol: document.getElementById('chkNormalizeVolModal')?.checked || false,
                        tempo: parseFloat(document.getElementById('tempoSlider')?.value || 1.0),
                        pitch: parseInt(document.getElementById('pitchSlider')?.value || 0),
                        reverse: document.getElementById('chkReverseAudio')?.checked || false
                    })
                });

                if (!res.ok) throw new Error('Error en el servidor al generar audio.');

                const blob = await res.blob();
                spanText.textContent = '¡Proceso finalizado con éxito! Descarga iniciada.';

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const titleForFile = document.getElementById('metaTitle').textContent.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'audio';
                a.download = `${titleForFile}_editado.${format}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                setTimeout(() => {
                    btnProcess.disabled = false;
                    btnProcess.classList.add('hover:bg-[#d43726]');
                    spanText.textContent = 'Procesar y Descargar Audio';
                    btnProcess.style.setProperty('--progress', '0%');
                }, 4000);

            } catch (err) {
                if (currentEvtSource) currentEvtSource.close();
                spanText.textContent = `Error de conexión con el servidor Python.`;
                console.error(err);
                setTimeout(() => {
                    btnProcess.disabled = false;
                    btnProcess.classList.remove('bg-[#1f1f1f]', 'border', 'border-[#FF422E]');
                    btnProcess.classList.add('bg-[#FF422E]', 'hover:bg-[#d43726]', 'shadow-[0_0_15px_rgba(255,66,46,0.4)]');
                    spanText.textContent = 'Procesar y Descargar Audio';
                    btnProcess.style.setProperty('--progress', '0%');
                }, 4000);
            }
        });

        let reversedAudioUrl = null;

        function audioBufferToWav(buffer) {
            const numChannels = buffer.numberOfChannels;
            const sampleRate = buffer.sampleRate;
            const format = 1;
            const bitDepth = 16;
            
            let result;
            if (numChannels === 2) {
                result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
            } else {
                result = buffer.getChannelData(0);
            }
            
            const bytesPerSample = bitDepth / 8;
            const blockAlign = numChannels * bytesPerSample;
            const dataByteCount = result.length * bytesPerSample;
            const headerByteCount = 44;
            const totalByteCount = headerByteCount + dataByteCount;
            
            const arrayBuffer = new ArrayBuffer(totalByteCount);
            const view = new DataView(arrayBuffer);

            function writeString(v, offset, str) {
                for (let i = 0; i < str.length; i++) {
                    v.setUint8(offset + i, str.charCodeAt(i));
                }
            }

            writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + dataByteCount, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, format, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * blockAlign, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitDepth, true);
            writeString(view, 36, 'data');
            view.setUint32(40, dataByteCount, true);

            let offset = 44;
            for (let i = 0; i < result.length; i++, offset += 2) {
                const s = Math.max(-1, Math.min(1, result[i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }

            return new Blob([arrayBuffer], { type: 'audio/wav' });
        }

        function interleave(inputL, inputR) {
            const length = inputL.length + inputR.length;
            const result = new Float32Array(length);
            let index = 0;
            let inputIndex = 0;
            while (index < length) {
                result[index++] = inputL[inputIndex];
                result[index++] = inputR[inputIndex];
                inputIndex++;
            }
            return result;
        }

        async function prepareReversedAudioUrl(url) {
            try {
                const res = await fetch(url);
                const arrayBuf = await res.arrayBuffer();
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuf = await ctx.decodeAudioData(arrayBuf);
                const revBuf = getReversedAudioBuffer(audioBuf);
                if (revBuf) {
                    const blob = audioBufferToWav(revBuf);
                    if (reversedAudioUrl) URL.revokeObjectURL(reversedAudioUrl);
                    reversedAudioUrl = URL.createObjectURL(blob);
                }
            } catch (e) {
                console.error("Error al preparar audio invertido:", e);
            }
        }

        function updateSpectrumFlipUI() {
            const isReverse = document.getElementById('chkReverseAudio')?.checked || false;
            const wfTrim = document.getElementById('waveformTrim');
            const wfGlobal = document.getElementById('waveform');
            
            if (wfTrim) wfTrim.classList.toggle('spectrum-reversed', isReverse);
            if (wfGlobal) {
                if (isEditedViewActive && isReverse) {
                    wfGlobal.classList.add('spectrum-reversed');
                } else {
                    wfGlobal.classList.remove('spectrum-reversed');
                }
            }
        }

        function toggleAudioReverseLive() {
            const isReverse = document.getElementById('chkReverseAudio')?.checked || false;
            updateSpectrumFlipUI();

            const targetWs = wsTrim || wsGlobal;
            if (!targetWs) return;

            const wasPlaying = targetWs.isPlaying();
            const curTime = targetWs.getCurrentTime();
            const targetUrl = (isReverse && reversedAudioUrl) ? reversedAudioUrl : audioUrlGlobal;

            if (wsTrim) {
                wsTrim.load(targetUrl);
            }
            if (wsGlobal && isEditedViewActive) {
                wsGlobal.load(targetUrl);
            }

            setTimeout(() => {
                const dur = videoDuration || 1;
                const newTime = Math.max(0, Math.min(dur, dur - curTime));
                if (wsTrim) {
                    wsTrim.setTime(newTime);
                    applyLiveAudioMath(wsTrim, false);
                    if (wasPlaying) wsTrim.play();
                }
                if (wsGlobal && isEditedViewActive) {
                    wsGlobal.setTime(newTime);
                    applyLiveAudioMath(wsGlobal, true);
                    if (wasPlaying) wsGlobal.play();
                }
            }, 120);
        }

        const tempoSlider = document.getElementById('tempoSlider');
        const lblTempoValue = document.getElementById('lblTempoValue');
        if (tempoSlider && lblTempoValue) {
            tempoSlider.addEventListener('input', (e) => {
                lblTempoValue.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
                if (wsTrim) applyLiveAudioMath(wsTrim, false);
                if (isEditedViewActive && wsGlobal) applyLiveAudioMath(wsGlobal, true);
                checkIfStateChanged();
            });
        }

        const pitchSlider = document.getElementById('pitchSlider');
        const lblPitchValue = document.getElementById('lblPitchValue');
        if (pitchSlider && lblPitchValue) {
            pitchSlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                lblPitchValue.textContent = `${val > 0 ? '+' : ''}${val} semitonos`;
                if (wsTrim) applyLiveAudioMath(wsTrim, false);
                if (isEditedViewActive && wsGlobal) applyLiveAudioMath(wsGlobal, true);
                checkIfStateChanged();
            });
        }

        const chkNormalizeVolModal = document.getElementById('chkNormalizeVolModal');
        if (chkNormalizeVolModal) {
            chkNormalizeVolModal.addEventListener('change', () => {
                if (wsTrim) applyLiveAudioMath(wsTrim, false);
                if (isEditedViewActive && wsGlobal) applyLiveAudioMath(wsGlobal, true);
                checkIfStateChanged();
            });
        }

        const chkReverseAudio = document.getElementById('chkReverseAudio');
        if (chkReverseAudio) {
            chkReverseAudio.addEventListener('change', () => {
                toggleAudioReverseLive();
                checkIfStateChanged();
            });
        }

        const tabTrim = document.getElementById('tabTrim');
        const tabFade = document.getElementById('tabFade');
        const tabAudio = document.getElementById('tabAudio');

        const secTrim = document.getElementById('secTrim');
        const secFade = document.getElementById('secFade');
        const secAudio = document.getElementById('secAudio');
        const modalSectionsContainer = document.getElementById('modalSectionsContainer');

        function activateTab(activeTab, targetSec) {
            [tabTrim, tabFade, tabAudio].forEach(tab => {
                if (tab) {
                    tab.classList.remove('bg-[#FF422E]', 'text-white', 'active');
                    tab.classList.add('bg-[#1f1f1f]', 'text-gray-300');
                }
            });
            if (activeTab) {
                activeTab.classList.remove('bg-[#1f1f1f]', 'text-gray-300');
                activeTab.classList.add('bg-[#FF422E]', 'text-white', 'active');
            }
            if (targetSec && modalSectionsContainer) {
                targetSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        if (tabTrim) tabTrim.addEventListener('click', () => activateTab(tabTrim, secTrim));
        if (tabFade) tabFade.addEventListener('click', () => activateTab(tabFade, secFade));
        if (tabAudio) tabAudio.addEventListener('click', () => activateTab(tabAudio, secAudio));

        const btnClearHistory = document.getElementById('btnClearHistory');
        if (btnClearHistory) {
            btnClearHistory.addEventListener('click', () => clearHistory());
        }

        renderHistory();
