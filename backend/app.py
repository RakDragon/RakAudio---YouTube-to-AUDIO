import json
import os
import re
import shutil
import struct
import threading
import time
import traceback
import uuid
from collections import deque

import ffmpeg
import numpy as np
import yt_dlp
from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

app = Flask(__name__)
CORS(app)

# ─── Global exception handler ─────────────────────────────────────────────────
@app.errorhandler(Exception)
def handle_exception(e):
    traceback.print_exc()
    if isinstance(e, HTTPException):
        return jsonify({"error": e.description}), e.code
    return jsonify({"error": str(e)}), 500

# ─── Directories ──────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
# realpath used here so path-traversal checks are consistent (no symlink bypass)
DOWNLOAD_DIR  = os.path.realpath(os.path.join(BASE_DIR, "temp_audio"))
PROCESSED_DIR = os.path.realpath(os.path.join(BASE_DIR, "processed_audio"))
os.makedirs(DOWNLOAD_DIR,  exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

# S2: Whitelist of extensions yt-dlp may produce
ALLOWED_EXTS = {"webm", "opus", "m4a", "mp3", "ogg", "flac", "wav", "aac"}

# ─── Progress store (thread-safe) ─────────────────────────────────────────────
progress_store: dict = {}
progress_lock  = threading.Lock()

def update_progress(client_id: str, data: dict) -> None:
    with progress_lock:
        progress_store[client_id] = data

def get_progress(client_id: str):
    with progress_lock:
        data = progress_store.get(client_id)
        return dict(data) if data else None

def remove_progress(client_id: str) -> None:
    with progress_lock:
        progress_store.pop(client_id, None)

# ─── FFmpeg check ─────────────────────────────────────────────────────────────
def check_ffmpeg() -> None:
    if shutil.which("ffmpeg"):
        print("[INFO] FFmpeg detectado correctamente en el sistema.")
    else:
        sep = "=" * 64
        print(f"{sep}\n[ADVERTENCIA] 'ffmpeg' no fue encontrado en el PATH del sistema.\n"
              f"Asegúrate de instalar FFmpeg para que la edición funcione correctamente.\n{sep}")

check_ffmpeg()

# ─── Automatic cleanup ────────────────────────────────────────────────────────
def cleanup_old_files(max_age_seconds: int = 3600) -> None:
    """Remove files older than max_age_seconds from temp directories."""
    now = time.time()
    for folder in (DOWNLOAD_DIR, PROCESSED_DIR):
        for fname in os.listdir(folder):
            fpath = os.path.join(folder, fname)
            try:
                if os.path.isfile(fpath) and now - os.path.getmtime(fpath) > max_age_seconds:
                    os.remove(fpath)
            except OSError:
                pass

def cleanup_async() -> None:
    """A4: Run cleanup in a daemon thread so it never blocks a Flask request."""
    threading.Thread(target=cleanup_old_files, daemon=True).start()

# ─── SSE: real-time progress ───────────────────────────────────────────────────
@app.route("/api/progress")
def progress():
    client_id = request.args.get("client_id", "default")

    def generate():
        start_time       = time.time()
        max_wait_seconds = 300
        while True:
            data = get_progress(client_id)
            if data:
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("status") in ("done", "error"):
                    time.sleep(0.5)
                    remove_progress(client_id)
                    break
            elif time.time() - start_time > max_wait_seconds:
                remove_progress(client_id)
                break
            time.sleep(0.2)

    return Response(generate(), mimetype="text/event-stream")

# ─── Extract audio ─────────────────────────────────────────────────────────────
@app.route("/api/extract", methods=["POST"])
def extract():
    client_id = "default"
    try:
        cleanup_async()  # A4: non-blocking

        body      = request.get_json(force=True, silent=True) or {}
        url       = body.get("url", "").strip()
        client_id = body.get("client_id", "default")

        if not url:
            return jsonify({"error": "Se requiere un enlace de YouTube"}), 400

        update_progress(client_id, {
            "status": "extracting", "progress": 5, "msg": "Extrayendo metadatos..."
        })

        def ytdl_hook(d):
            if d["status"] == "downloading":
                raw = re.sub(r"\x1b[^m]*m", "", d.get("_percent_str", "0%").replace("%", "")).strip()
                try:
                    pct = float(raw)
                    update_progress(client_id, {
                        "status": "downloading", "progress": pct,
                        "msg": f"Descargando audio del servidor: {pct:.1f}%"
                    })
                except ValueError:
                    pass
            elif d["status"] == "finished":
                update_progress(client_id, {
                    "status": "downloading", "progress": 100,
                    "msg": "Descarga temporal completada."
                })

        ydl_opts = {
            "format":         "bestaudio/best",
            "outtmpl":        os.path.join(DOWNLOAD_DIR, "%(id)s.%(ext)s"),
            "noplaylist":     True,
            "quiet":          True,
            "progress_hooks": [ytdl_hook],
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        video_id = info["id"]
        ext      = info["ext"]
        raw_date = info.get("upload_date", "")
        fmt_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}" if len(raw_date) == 8 else "N/A"
        audio_url = f"{request.host_url.rstrip('/')}/api/audio/{video_id}.{ext}"

        update_progress(client_id, {
            "status": "done", "progress": 100, "msg": "Datos listos para procesar."
        })

        return jsonify({
            "id":           video_id,
            "ext":          ext,
            "title":        info.get("title"),
            "uploader":     info.get("uploader"),
            "views":        info.get("view_count"),
            "uploadDate":   fmt_date,
            "thumbnailUrl": info.get("thumbnail"),
            "duration":     info.get("duration"),
            "audioUrl":     audio_url,
        })

    except Exception as e:
        traceback.print_exc()
        update_progress(client_id, {"status": "error", "progress": 0, "msg": str(e)})
        return jsonify({"error": str(e)}), 500

# ─── Serve downloaded audio ────────────────────────────────────────────────────
@app.route("/api/audio/<path:filename>")
def get_audio(filename):
    # S1: Path-traversal protection — resolved path must stay inside DOWNLOAD_DIR.
    # Using realpath on both sides handles symlinks and '..' components uniformly.
    resolved = os.path.realpath(os.path.join(DOWNLOAD_DIR, filename))
    safe_root = DOWNLOAD_DIR + os.sep
    if not (resolved.startswith(safe_root) or resolved == DOWNLOAD_DIR):
        return jsonify({"error": "Ruta inválida"}), 400
    if os.path.isfile(resolved):
        return send_file(resolved)
    return jsonify({"error": "Archivo no encontrado"}), 404

# ─── Auditorium Reverb DSP ───────────────────────────────────────────────────
def apply_auditorium_reverb(samples: np.ndarray, sr: int) -> np.ndarray:
    """Three-stage auditorium reverb: Predelay → Early Reflections → FDN tail.

    Args:
        samples: float32 array of shape (n_frames, n_channels). Must be stereo.
        sr:      sample rate in Hz.

    Returns:
        Processed float32 array of the same shape, values clamped to [-1, 1].
    """
    n_frames, n_ch = samples.shape
    if n_ch < 2:
        # Upmix mono → stereo for spatial processing
        samples = np.stack([samples[:, 0], samples[:, 0]], axis=1)
        n_ch = 2

    out = np.zeros_like(samples, dtype=np.float64)
    src = samples.astype(np.float64)

    # ── Stage 1: Predelay (30 ms) ────────────────────────────────────────────
    predelay = int(0.030 * sr)
    delayed = np.zeros_like(src)
    delayed[predelay:] = src[: n_frames - predelay]

    # ── Stage 2: Early Reflections ───────────────────────────────────────────
    # Seven parallel stereo delays; cross-feed between L/R simulates lateral
    # reflections off walls and creates perceived spatial width.
    early_taps = [
        # (delay_ms, gain_L, gain_R, cross_L, cross_R)
        (17,  0.80, 0.70, 0.08, 0.06),
        (23,  0.70, 0.80, 0.06, 0.08),
        (31,  0.60, 0.60, 0.10, 0.10),
        (37,  0.50, 0.65, 0.07, 0.09),
        (43,  0.55, 0.50, 0.09, 0.07),
        (53,  0.40, 0.45, 0.06, 0.06),
        (67,  0.35, 0.40, 0.05, 0.05),
    ]

    early = np.zeros_like(src)
    for delay_ms, g_l, g_r, cx_l, cx_r in early_taps:
        d = int((delay_ms / 1000.0) * sr)
        if d >= n_frames:
            continue
        tap = np.zeros_like(src)
        tap[d:, 0] = delayed[: n_frames - d, 0] * g_l + delayed[: n_frames - d, 1] * cx_l
        tap[d:, 1] = delayed[: n_frames - d, 1] * g_r + delayed[: n_frames - d, 0] * cx_r
        early += tap

    # ── Stage 3: FDN Reverb tail with High-Cut filter ────────────────────────
    # Four parallel feedback delay lines tuned to mutually prime lengths.
    # RT60 ≈ 2 s → feedback gain g = 0.001^(delay/RT60).
    RT60        = 2.0
    fdn_delays_ms = [67, 89, 113, 151]   # prime-ish, stagger comb peaks
    fdn_out = np.zeros_like(src)

    # High-cut 1st-order IIR low-pass at f_cut Hz.
    # Coefficient: α = exp(-2π·f_cut / sr)
    f_cut = 7000.0
    alpha = np.exp(-2.0 * np.pi * f_cut / sr)

    for d_ms in fdn_delays_ms:
        d      = int((d_ms / 1000.0) * sr)
        if d < 1:
            continue
        g      = 0.001 ** (d / (RT60 * sr))   # Sabine decay per sample-block
        buf    = np.zeros((d, n_ch), dtype=np.float64)
        line   = np.zeros_like(src)
        lp_y   = np.zeros(n_ch, dtype=np.float64)  # IIR state

        for i in range(n_frames):
            idx   = i % d
            x_in  = early[i] + buf[idx] * g
            # High-cut filter update
            lp_y  = alpha * lp_y + (1.0 - alpha) * x_in
            buf[idx] = lp_y
            line[i]  = lp_y

        fdn_out += line

    # ── Mix dry + early + reverb tail ────────────────────────────────────────
    wet_early = 0.30
    wet_tail  = 0.25
    dry       = 0.55
    out = dry * src + wet_early * early + wet_tail * fdn_out

    return np.clip(out, -1.0, 1.0).astype(np.float32)


# ─── Process audio ─────────────────────────────────────────────────────────────
@app.route("/api/process", methods=["POST"])
def process_audio():
    data = request.get_json(force=True, silent=True) or {}

    client_id  = data.get("client_id", "default")
    video_id   = data.get("id", "")
    ext        = data.get("ext", "")
    out_format = data.get("format", "mp3")

    # S2: Validate video_id and ext before building any filesystem path
    if not re.fullmatch(r"[a-zA-Z0-9_\-]+", video_id or ""):
        return jsonify({"error": "ID de video inválido"}), 400
    if (ext or "") not in ALLOWED_EXTS:
        return jsonify({"error": "Extensión de audio no permitida"}), 400

    start = float(data.get("start", 0))
    end   = float(data.get("end",   0))

    # S6: Reject nonsensical time ranges early — avoids cryptic FFmpeg errors
    if end <= start:
        return jsonify({"error": "El tiempo de fin debe ser mayor al de inicio"}), 400

    fade_in       = float(data.get("fadeIn",    0))
    fade_out      = float(data.get("fadeOut",   0))
    quality       = data.get("quality", "320k")
    adjust_vol    = bool(data.get("adjustVol",    False))
    vol_level     = float(data.get("volLevel",   1.0))
    normalize_vol = bool(data.get("normalizeVol", False))
    tempo         = max(0.5, min(2.0, float(data.get("tempo", 1.0))))
    pitch         = max(-12,  min(12,  int(data.get("pitch",  0))))
    reverse            = bool(data.get("reverse",           False))
    auditorium_reverb  = bool(data.get("auditoriumReverb",  False))

    input_path = os.path.join(DOWNLOAD_DIR, f"{video_id}.{ext}")
    if not os.path.exists(input_path):
        return jsonify({"error": "Audio original no encontrado"}), 404

    output_path = os.path.join(PROCESSED_DIR, f"{uuid.uuid4().hex}.{out_format}")

    update_progress(client_id, {
        "status": "processing", "progress": 0,
        "msg": "Enviando solicitud al servidor. Procesando recortes y efectos..."
    })

    try:
        stream           = ffmpeg.input(input_path, ss=start, to=end)
        duration_trimmed = end - start

        if adjust_vol and vol_level != 1.0:
            stream = ffmpeg.filter(stream, "volume", str(vol_level))

        if normalize_vol:
            stream = ffmpeg.filter(stream, "loudnorm")

        if pitch != 0:
            pitch_factor = 2.0 ** (pitch / 12.0)
            stream       = ffmpeg.filter(stream, "asetrate", str(int(44100 * pitch_factor)))
            stream       = ffmpeg.filter(stream, "aresample", "44100")
            tempo        = tempo / pitch_factor

        if abs(tempo - 1.0) > 0.001:
            eff = tempo
            while eff > 2.0: stream = ffmpeg.filter(stream, "atempo", "2.0"); eff /= 2.0
            while eff < 0.5: stream = ffmpeg.filter(stream, "atempo", "0.5"); eff *= 2.0
            if abs(eff - 1.0) > 0.001:
                stream = ffmpeg.filter(stream, "atempo", f"{eff:.4f}")
            duration_trimmed /= (float(data.get("tempo", 1.0)) or 1.0)

        if reverse:
            stream = ffmpeg.filter(stream, "areverse")

        if fade_in > 0:
            stream = ffmpeg.filter(stream, "afade", type="in",  start_time=0, duration=fade_in)
        if fade_out > 0:
            stream = ffmpeg.filter(stream, "afade", type="out",
                                   start_time=max(0.0, duration_trimmed - fade_out), duration=fade_out)

        # ── Auditorium Reverb: Offline DSP via PCM pipe ──────────────────────
        # If requested, decode the current stream to raw PCM float32 into memory,
        # apply the three-stage DSP, then swap output_path for a WAV temp file
        # so the subsequent FFmpeg re-encode reads the processed PCM.
        if auditorium_reverb:
            update_progress(client_id, {
                "status": "processing", "progress": 30,
                "msg": "Aplicando efecto de auditorio (Offline DSP)..."
            })

            # Step A: decode to raw stereo float32 s16le via pipe
            pcm_raw, pcm_err = (
                ffmpeg.output(stream, "pipe:", format="f32le", ac=2, ar=44100)
                .run(capture_stdout=True, capture_stderr=True, quiet=True)
            )

            if not pcm_raw:
                err_msg = pcm_err.decode("utf-8", errors="ignore").strip()
                raise RuntimeError(f"No se pudo decodificar PCM para DSP: {err_msg}")

            # Step B: reshape to (n_frames, 2) and apply DSP
            samples = np.frombuffer(pcm_raw, dtype=np.float32).reshape(-1, 2)
            processed = apply_auditorium_reverb(samples, 44100)

            # Step C: write processed PCM to a temp WAV file
            wav_tmp = output_path.replace(f".{out_format}", "_reverb_tmp.wav")
            pcm_bytes = processed.tobytes()
            n_frames_dsp   = processed.shape[0]
            n_ch_dsp       = 2
            sr_dsp         = 44100
            bps            = 4  # float32
            block_align    = n_ch_dsp * bps
            byte_rate      = sr_dsp * block_align
            data_size      = len(pcm_bytes)
            with open(wav_tmp, "wb") as wf:
                # Minimal RIFF/WAV header for 32-bit float PCM
                wf.write(b"RIFF")
                wf.write(struct.pack("<I", 36 + data_size))
                wf.write(b"WAVE")
                wf.write(b"fmt ")
                wf.write(struct.pack("<I", 16))          # chunk size
                wf.write(struct.pack("<H", 3))           # PCM float = 3
                wf.write(struct.pack("<H", n_ch_dsp))
                wf.write(struct.pack("<I", sr_dsp))
                wf.write(struct.pack("<I", byte_rate))
                wf.write(struct.pack("<H", block_align))
                wf.write(struct.pack("<H", bps * 8))     # bits per sample
                wf.write(b"data")
                wf.write(struct.pack("<I", data_size))
                wf.write(pcm_bytes)

            # Step D: re-encode from temp WAV → final output
            stream = ffmpeg.input(wav_tmp)
            update_progress(client_id, {
                "status": "processing", "progress": 60,
                "msg": "Re-codificando con efecto de auditorio..."
            })

        codec_kwargs: dict = {}
        if out_format in ("mp3", "m4a"):
            codec_kwargs["audio_bitrate"] = quality
            if out_format == "m4a":
                codec_kwargs["acodec"] = "aac"
        elif out_format == "wav":
            codec_kwargs["acodec"] = "pcm_s16le"

        process = ffmpeg.run_async(
            ffmpeg.output(stream, output_path, **codec_kwargs),
            pipe_stderr=True, overwrite_output=True, quiet=True,
        )

        time_regex   = re.compile(r"time=(?P<time>\d+:\d+:\d+\.\d+)")
        # A5: deque(maxlen=N) gives O(1) append+truncate; list.pop(0) is O(n)
        stderr_lines = deque(maxlen=20)

        for line in process.stderr:
            line_str = line.decode("utf-8", errors="ignore")
            stderr_lines.append(line_str)
            m = time_regex.search(line_str)
            if m:
                h, mn, s    = m.group("time").split(":")
                current_sec = int(h) * 3600 + int(mn) * 60 + float(s)
                if duration_trimmed > 0:
                    perc = min(99, (current_sec / duration_trimmed) * 100)
                    update_progress(client_id, {
                        "status": "processing", "progress": perc,
                        "msg": f"Procesando audio: {perc:.1f}%"
                    })

        process.wait()

        if process.returncode != 0:
            err_details = "".join(stderr_lines).strip() or "FFmpeg devolvió un error interno."
            raise RuntimeError(f"Error en FFmpeg: {err_details}")

        update_progress(client_id, {
            "status": "done", "progress": 100, "msg": "Recibiendo archivo generado..."
        })

        response = send_file(output_path, as_attachment=True, download_name=f"procesado.{out_format}")

        # Cleanup temp WAV if auditorium DSP was used
        if auditorium_reverb:
            wav_tmp_path = output_path.replace(f".{out_format}", "_reverb_tmp.wav")
            try:
                os.remove(wav_tmp_path)
            except OSError:
                pass

        return response

    except (RuntimeError, ValueError, OSError) as e:
        traceback.print_exc()
        update_progress(client_id, {"status": "error", "progress": 0, "msg": str(e)})
        return jsonify({"error": str(e)}), 500

# ─── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=False, port=5050, threaded=True)