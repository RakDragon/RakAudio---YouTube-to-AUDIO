import glob
import json
import os
import re
import shutil
import threading
import time
import uuid

import ffmpeg
import yt_dlp
from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE_DIR, "temp_audio")
PROCESSED_DIR = os.path.join(BASE_DIR, "processed_audio")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

progress_store = {}
progress_lock = threading.Lock()

def update_progress(client_id, data):
    with progress_lock:
        progress_store[client_id] = data

def get_progress(client_id):
    with progress_lock:
        data = progress_store.get(client_id)
        return dict(data) if data else None

def remove_progress(client_id):
    with progress_lock:
        progress_store.pop(client_id, None)

def check_ffmpeg():
    if not shutil.which("ffmpeg"):
        print("================================================================")
        print("[ADVERTENCIA] 'ffmpeg' no fue encontrado en el PATH del sistema.")
        print("Asegúrate de instalar FFmpeg para que la edición funcione correctamente.")
        print("================================================================")
    else:
        print("[INFO] FFmpeg detectado correctamente en el sistema.")

check_ffmpeg()

def cleanup_old_files(max_age_seconds=3600):
    """Elimina archivos en carpetas temporales con más de max_age_seconds de antigüedad (por defecto 1h)."""
    now = time.time()
    for folder in [DOWNLOAD_DIR, PROCESSED_DIR]:
        for filepath in glob.glob(os.path.join(folder, "*")):
            try:
                if os.path.isfile(filepath):
                    file_age = now - os.path.getmtime(filepath)
                    if file_age > max_age_seconds:
                        os.remove(filepath)
            except OSError:
                pass

@app.route("/api/progress")
def progress():
    client_id = request.args.get("client_id")
    def generate():
        start_time = time.time()
        max_wait_seconds = 300  # Timeout máximo de 5 minutos por conexión SSE
        while True:
            data = get_progress(client_id)
            if data:
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("status") in ["done", "error"]:
                    time.sleep(0.5)
                    remove_progress(client_id)
                    break
            elif time.time() - start_time > max_wait_seconds:
                remove_progress(client_id)
                break
            time.sleep(0.2)
    return Response(generate(), mimetype="text/event-stream")

@app.route("/api/extract", methods=["POST"])
def extract():
    cleanup_old_files()

    data = request.json
    url = data.get("url")
    client_id = data.get("client_id", "default")
    
    if not url:
        return jsonify({"error": "Se requiere un enlace de YouTube"}), 400

    update_progress(client_id, {"status": "extracting", "progress": 5, "msg": "Extrayendo metadatos..."})

    def ytdl_progress_hook(d):
        if d['status'] == 'downloading':
            percent_str = d.get('_percent_str', '0%').replace('%', '')
            percent_str = re.sub(r'\x1b[^m]*m', '', percent_str).strip()
            try:
                update_progress(client_id, {
                    "status": "downloading", 
                    "progress": float(percent_str), 
                    "msg": f"Descargando audio del servidor: {percent_str}%"
                })
            except ValueError:
                pass
        elif d['status'] == 'finished':
            update_progress(client_id, {"status": "downloading", "progress": 100, "msg": "Descarga temporal completada."})

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": f"{DOWNLOAD_DIR}/%(id)s.%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "progress_hooks": [ytdl_progress_hook],
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            video_id = info["id"]
            ext = info["ext"]
            raw_date = info.get("upload_date", "")
            fmt_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}" if raw_date else "N/A"

            update_progress(client_id, {"status": "done", "progress": 100, "msg": "Datos listos para procesar."})

            return jsonify({
                "id": video_id,
                "ext": ext,
                "title": info.get("title"),
                "uploader": info.get("uploader"),
                "views": info.get("view_count"),
                "uploadDate": fmt_date,
                "thumbnailUrl": info.get("thumbnail"),
                "duration": info.get("duration"),
                "audioUrl": f"http://localhost:5050/api/audio/{video_id}.{ext}",
            })
    except yt_dlp.utils.DownloadError as e:
        update_progress(client_id, {"status": "error", "progress": 0, "msg": str(e)})
        return jsonify({"error": str(e)}), 500

@app.route("/api/audio/<filename>")
def get_audio(filename):
    file_path = os.path.join(DOWNLOAD_DIR, filename)
    if os.path.exists(file_path):
        return send_file(file_path)
    return jsonify({"error": "Archivo no encontrado"}), 404

@app.route("/api/process", methods=["POST"])
def process_audio():
    data = request.json
    client_id = data.get("client_id", "default")
    video_id = data.get("id")
    ext = data.get("ext")
    start = float(data.get("start", 0))
    end = float(data.get("end", 0))
    fade_in = float(data.get("fadeIn", 0))
    fade_out = float(data.get("fadeOut", 0))
    out_format = data.get("format", "mp3")
    quality = data.get("quality", "320k")
    
    # Parámetros de volumen, velocidad, tono y reversa
    adjust_vol = data.get("adjustVol", False)
    vol_level = float(data.get("volLevel", 1.0))
    normalize_vol = data.get("normalizeVol", False)
    tempo = float(data.get("tempo", 1.0))
    tempo = max(0.5, min(2.0, tempo))
    pitch = int(data.get("pitch", 0))
    pitch = max(-12, min(12, pitch))
    reverse = bool(data.get("reverse", False))

    input_path = os.path.join(DOWNLOAD_DIR, f"{video_id}.{ext}")
    if not os.path.exists(input_path):
        return jsonify({"error": "Audio original no encontrado"}), 404

    output_filename = f"{uuid.uuid4().hex}.{out_format}"
    output_path = os.path.join(PROCESSED_DIR, output_filename)

    update_progress(client_id, {"status": "processing", "progress": 0, "msg": "Enviando solicitud al servidor. Procesando recortes y efectos..."})

    try:
        stream = ffmpeg.input(input_path, ss=start, to=end)
        duration_trimmed = end - start

        # 1. Filtro de volumen manual
        if adjust_vol and vol_level != 1.0:
            stream = ffmpeg.filter(stream, "volume", str(vol_level))

        # 2. Normalización EBU R128
        if normalize_vol:
            stream = ffmpeg.filter(stream, "loudnorm")

        # 3. Cambio de tono (Pitch semitonos)
        if pitch != 0:
            pitch_factor = 2.0 ** (pitch / 12.0)
            target_rate = int(44100 * pitch_factor)
            stream = ffmpeg.filter(stream, "asetrate", str(target_rate))
            stream = ffmpeg.filter(stream, "aresample", "44100")
            tempo = tempo / pitch_factor

        # 4. Control de velocidad (atempo)
        if abs(tempo - 1.0) > 0.001:
            eff_tempo = tempo
            while eff_tempo > 2.0:
                stream = ffmpeg.filter(stream, "atempo", "2.0")
                eff_tempo /= 2.0
            while eff_tempo < 0.5:
                stream = ffmpeg.filter(stream, "atempo", "0.5")
                eff_tempo /= 0.5
            if abs(eff_tempo - 1.0) > 0.001:
                stream = ffmpeg.filter(stream, "atempo", f"{eff_tempo:.4f}")
            
            duration_trimmed = duration_trimmed / (float(data.get("tempo", 1.0)) or 1.0)

        # 5. Efecto Reversa (Audio Reverse)
        if reverse:
            stream = ffmpeg.filter(stream, "areverse")

        # 6. Filtros de fade
        if fade_in > 0:
            stream = ffmpeg.filter(stream, "afade", type="in", start_time=0, duration=fade_in)
        if fade_out > 0:
            start_fade_out = max(0.0, duration_trimmed - fade_out)
            stream = ffmpeg.filter(stream, "afade", type="out", start_time=start_fade_out, duration=fade_out)

        kwargs = {}
        if out_format in ["mp3", "m4a"]:
            kwargs["audio_bitrate"] = quality
            if out_format == "m4a":
                kwargs["acodec"] = "aac"
        elif out_format == "wav":
            kwargs["acodec"] = "pcm_s16le"

        stream = ffmpeg.output(stream, output_path, **kwargs)
        
        process = ffmpeg.run_async(stream, pipe_stderr=True, overwrite_output=True, quiet=True)
        time_regex = re.compile(r'time=(?P<time>\d+:\d+:\d+\.\d+)')
        
        stderr_lines = []
        for line in process.stderr:
            line_str = line.decode('utf-8', errors='ignore')
            stderr_lines.append(line_str)
            if len(stderr_lines) > 20:
                stderr_lines.pop(0)

            match = time_regex.search(line_str)
            if match:
                h, m, s = match.group('time').split(':')
                current_sec = int(h)*3600 + int(m)*60 + float(s)
                if duration_trimmed > 0:
                    perc = (current_sec / duration_trimmed) * 100
                    update_progress(client_id, {
                        "status": "processing", 
                        "progress": min(99, perc), 
                        "msg": f"Procesando audio: {perc:.1f}%"
                    })
        
        process.wait()
        
        if process.returncode != 0:
            err_details = "".join(stderr_lines).strip() or "FFmpeg devolvió un error interno."
            raise RuntimeError(f"Error en FFmpeg: {err_details}")

        update_progress(client_id, {"status": "done", "progress": 100, "msg": "Recibiendo archivo generado..."})
        
        return send_file(output_path, as_attachment=True, download_name=f"procesado.{out_format}")

    except (RuntimeError, ValueError, OSError) as e:
        update_progress(client_id, {"status": "error", "progress": 0, "msg": str(e)})
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", debug=True, port=5050, threaded=True)