import glob
import json
import os
import re
import time
import uuid

import ffmpeg
import yt_dlp
from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = "temp_audio"
PROCESSED_DIR = "processed_audio"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)

# Diccionario en memoria para rastrear el progreso de los clientes
progress_store = {}

@app.route("/api/progress")
def progress():
    client_id = request.args.get("client_id")
    def generate():
        while True:
            if client_id in progress_store:
                data = progress_store[client_id]
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("status") in ["done", "error"]:
                    break
            time.sleep(0.2)
    return Response(generate(), mimetype="text/event-stream")

@app.route("/api/extract", methods=["POST"])
def extract():
    for filepath in glob.glob(f"{DOWNLOAD_DIR}/*") + glob.glob(f"{PROCESSED_DIR}/*"):
        try:
            os.remove(filepath)
        except OSError:
            pass

    data = request.json
    url = data.get("url")
    client_id = data.get("client_id", "default")
    
    if not url:
        return jsonify({"error": "Se requiere un enlace de YouTube"}), 400

    progress_store[client_id] = {"status": "extracting", "progress": 5, "msg": "Extrayendo metadatos..."}

    def ytdl_progress_hook(d):
        if d['status'] == 'downloading':
            # Limpiar caracteres ANSI del porcentaje que arroja yt-dlp
            percent_str = d.get('_percent_str', '0%').replace('%', '')
            percent_str = re.sub(r'\x1b[^m]*m', '', percent_str).strip()
            try:
                progress_store[client_id] = {
                    "status": "downloading", 
                    "progress": float(percent_str), 
                    "msg": f"Descargando audio del servidor: {percent_str}%"
                }
            except ValueError:
                pass
        elif d['status'] == 'finished':
            progress_store[client_id] = {"status": "downloading", "progress": 100, "msg": "Descarga temporal completada."}

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

            progress_store[client_id] = {"status": "done", "progress": 100, "msg": "Datos listos para procesar."}

            return jsonify({
                "id": video_id,
                "ext": ext,
                "title": info.get("title"),
                "uploader": info.get("uploader"),
                "views": info.get("view_count"),
                "uploadDate": fmt_date,
                "thumbnailUrl": info.get("thumbnail"),
                "duration": info.get("duration"),
                "audioUrl": f"http://localhost:5000/api/audio/{video_id}.{ext}",
            })
    except yt_dlp.utils.DownloadError as e:
        progress_store[client_id] = {"status": "error", "progress": 0, "msg": str(e)}
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

    input_path = os.path.join(DOWNLOAD_DIR, f"{video_id}.{ext}")
    if not os.path.exists(input_path):
        return jsonify({"error": "Audio original no encontrado"}), 404

    output_filename = f"{uuid.uuid4().hex}.{out_format}"
    output_path = os.path.join(PROCESSED_DIR, output_filename)

    progress_store[client_id] = {"status": "processing", "progress": 0, "msg": "Enviando solicitud al servidor. Procesando recortes y efectos..."}

    try:
        stream = ffmpeg.input(input_path, ss=start, to=end)
        duration_trimmed = end - start

        if fade_in > 0:
            stream = ffmpeg.filter(stream, "afade", type="in", start_time=0, duration=fade_in)
        if fade_out > 0:
            stream = ffmpeg.filter(stream, "afade", type="out", start_time=duration_trimmed - fade_out, duration=fade_out)

        kwargs = {}
        if out_format in ["mp3", "m4a"]:
            kwargs["audio_bitrate"] = quality
            if out_format == "m4a":
                kwargs["acodec"] = "aac"

        stream = ffmpeg.output(stream, output_path, **kwargs)
        
        # Ejecutar asíncronamente capturando stderr para leer el avance
        process = ffmpeg.run_async(stream, pipe_stderr=True, overwrite_output=True, quiet=True)
        time_regex = re.compile(r'time=(?P<time>\d+:\d+:\d+\.\d+)')
        
        for line in process.stderr:
            line_str = line.decode('utf-8', errors='ignore')
            match = time_regex.search(line_str)
            if match:
                h, m, s = match.group('time').split(':')
                current_sec = int(h)*3600 + int(m)*60 + float(s)
                if duration_trimmed > 0:
                    perc = (current_sec / duration_trimmed) * 100
                    progress_store[client_id] = {
                        "status": "processing", 
                        "progress": min(99, perc), 
                        "msg": f"Procesando audio: {perc:.1f}%"
                    }
        
        process.wait()
        
        if process.returncode != 0:
            raise RuntimeError("FFmpeg devolvió un error interno.")

        progress_store[client_id] = {"status": "done", "progress": 100, "msg": "Recibiendo archivo generado..."}
        
        return send_file(output_path, as_attachment=True, download_name=f"procesado.{out_format}")

    except (RuntimeError, ValueError, OSError) as e:
        progress_store[client_id] = {"status": "error", "progress": 0, "msg": str(e)}
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000, threaded=True)