import json
import os
import re
import shutil
import threading
import time
import traceback
import uuid
from collections import deque

import ffmpeg

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
            "no_warnings":    True,
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
    # Path-traversal protection
    resolved = os.path.realpath(os.path.join(DOWNLOAD_DIR, filename))
    safe_root = DOWNLOAD_DIR + os.sep
    if not (resolved.startswith(safe_root) or resolved == DOWNLOAD_DIR):
        return jsonify({"error": "Ruta inválida"}), 400
    if os.path.isfile(resolved):
        return send_file(resolved)
    return jsonify({"error": "Archivo no encontrado"}), 404

@app.route("/api/process", methods=["POST"])
def process_audio():
    client_id  = request.form.get("client_id", "default")
    video_id   = request.form.get("id", "")
    out_format = request.form.get("format", "mp3")
    quality    = request.form.get("quality", "320k")

    if not re.fullmatch(r"[a-zA-Z0-9_\-]+", video_id or ""):
        return jsonify({"error": "ID de video inválido"}), 400

    if 'audioFile' not in request.files:
        return jsonify({"error": "No se recibió el archivo de audio renderizado"}), 400
        
    file = request.files['audioFile']
    if file.filename == '':
        return jsonify({"error": "Archivo vacío"}), 400

    input_path = os.path.join(PROCESSED_DIR, f"{uuid.uuid4().hex}_rendered.wav")
    file.save(input_path)

    output_path = os.path.join(PROCESSED_DIR, f"{uuid.uuid4().hex}.{out_format}")

    update_progress(client_id, {
        "status": "processing", "progress": 0,
        "msg": "Procesando conversión de formato..."
    })

    try:
        stream = ffmpeg.input(input_path)
        
        codec_kwargs: dict = {}
        if out_format in ("mp3", "m4a"):
            codec_kwargs["audio_bitrate"] = quality
            if out_format == "m4a":
                codec_kwargs["acodec"] = "aac"
        elif out_format == "wav":
            codec_kwargs["acodec"] = "pcm_s16le"

        # Overwrite output
        stream = ffmpeg.output(stream, output_path, **codec_kwargs, y=None)
        
        update_progress(client_id, {"status": "processing", "progress": 50, "msg": "Generando archivo final y aplicando metadatos..."})
        ffmpeg.run(stream, capture_stdout=True, capture_stderr=True)

        # Cleanup
        if os.path.exists(input_path):
            try: os.remove(input_path)
            except: pass
            
        update_progress(client_id, {"status": "done", "progress": 100, "msg": "¡Audio exportado con éxito!"})
        return send_file(output_path, as_attachment=True, download_name=f"audio_editado.{out_format}")

    except ffmpeg.Error as e:
        traceback.print_exc()
        if e.stderr:
            print("FFMPEG STDERR:", e.stderr.decode("utf-8"))
        update_progress(client_id, {"status": "error", "progress": 0, "msg": "Error en procesamiento de FFmpeg."})
        return jsonify({"error": "Error interno de FFmpeg"}), 500
    except Exception as e:
        traceback.print_exc()
        update_progress(client_id, {"status": "error", "progress": 0, "msg": str(e)})
        return jsonify({"error": str(e)}), 500

# ─── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=False, port=5050, threaded=True)