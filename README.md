# YT to Audio

Herramienta local para extraer audio de YouTube, recortarlo, aplicar fades/volumen y exportarlo en MP3/M4A.

## Estructura del proyecto

```
YT-to-Audio/
├── backend/                # API Flask
│   ├── app.py
│   ├── requirements.txt
│   ├── temp_audio/         # audio original descargado (generado en runtime)
│   └── processed_audio/    # audio ya procesado (generado en runtime)
├── frontend/                # Interfaz web estática
│   ├── index.html
│   ├── css/styles.css
│   └── js/main.js
├── scripts/
│   └── start.bat            # arranca backend + frontend con un doble clic
├── .gitignore
└── requirements.txt -> backend/requirements.txt
```

## Requisitos

- Python 3.10+
- [FFmpeg](https://ffmpeg.org/download.html) instalado y disponible en el PATH

## Instalación

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

## Uso

Opción rápida (Windows): doble clic en `scripts/start.bat`.

Manual:

```bash
# Terminal 1
cd backend
python app.py

# Terminal 2
cd frontend
python -m http.server 8000
```

Luego abre `http://localhost:8000` en el navegador.

## Notas

- El backend escucha en el puerto `5050`.
- El frontend se sirve como archivos estáticos en el puerto `8000`.
