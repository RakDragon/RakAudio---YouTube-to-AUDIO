# RakAudio - YouTube to AUDIO

> Herramienta local avanzada para descargar, previsualizar, editar y procesar audios de YouTube en tiempo real con una interfaz moderna y fluida.

---

## Características Principales

### 1. Extracción y Descarga de Audio
- **Descarga directa en alta calidad** desde enlaces de YouTube utilizando `yt-dlp` y `FFmpeg`.
- **Múltiples formatos de exportación**: `MP3`, `M4A`, `WAV`, `FLAC`, `AAC`, `OPUS`.
- **Selector de calidad**: Desde `128 kbps` hasta `320 kbps` (o bitrate máximo según formato).
- **Lectura completa de metadatos**: Título, canal, número de vistas, fecha de publicación, duración y miniatura en alta resolución.
- **Progreso en tiempo real**: Transmisión de progreso de descarga vía *Server-Sent Events* (SSE).

---

### 2. Previsualización y Ajustes Globales
- **Onda Espectral Interactiva**: Renderizado dinámico de la onda con `WaveSurfer.js v7`.
- **Alternador de Vista (Original vs. Editado)**:
  - **Original**: Reproducción limpia del audio crudo extraído con su propio control de volumen independiente.
  - **Editado**: Previsualización en vivo de todos los efectos aplicados (recortes, fades, velocidad, tono, volumen manual, normalización y reverse) sin necesidad de procesar el archivo completo previamente.
  - **Transición sin saltos**: Reproducción continua e ininterrumpida al alternar entre ambas vistas.
- **Controles completos de reproducción**: Play/Pause, salto rápido de ±5s, ±10s e ir al inicio o final de la pista.

---

### 3. Panel "MÁS HERRAMIENTAS" (Edición Avanzada)
- **Recorte Preciso de Audio**:
  - Definición de límites mediante tiradores visuales izquierdo y derecho sobre el espectrograma.
  - Botón **"Escuchar Selección"** con barra de progreso integrada en el fondo del botón (*fill progresivo* de izquierda a derecha).
- **Efectos de Fade In / Fade Out**:
  - Transiciones suaves de entrada y salida configurables en segundos.
  - Sombra y curva de decoloración visual proyectada directamente sobre la onda espectral.
- **Procesamiento en Vivo**:
  - **Ajuste de Volumen Manual**: Incremento o atenuación de 0% a 200%.
  - **Velocidad (Tempo)**: Variación en tiempo real desde 0.25x hasta 4.00x.
  - **Cambio de Tono (Pitch)**: Ajuste de ±12 semitonos conservando o ajustando el tempo.
  - **Normalización EBU R128**: Estándar profesional de volumen para transmisiones (+3.5 dB de ganancia).
  - **Invertir Audio (Audio Reverse)**: Invierte la pista de audio e invierte horizontalmente el espectrograma (*Effect Flip*) tanto en el editor como en la previsualización global.

---

### 4. Atajos de Teclado y Accesibilidad

| Tecla / Combinación | Acción |
| :--- | :--- |
| <kbd>Espacio</kbd> | Reproducir / Pausar audio activo |
| <kbd>Flecha Arriba</kbd> / <kbd>Flecha Abajo</kbd> | Subir / Bajar volumen en pasos de 5% |
| <kbd>1</kbd> | Activar modo de ajuste para el **Límite Izquierdo** |
| <kbd>2</kbd> | Activar modo de movimiento para el **Cabezal de Reproducción** |
| <kbd>3</kbd> | Activar modo de ajuste para el **Límite Derecho** |
| <kbd>Flecha Izquierda</kbd> / <kbd>Derecha</kbd> | Desplazar cabezal/límite **10 segundos** |
| <kbd>Shift</kbd> + <kbd>Flechas</kbd> | Desplazar cabezal/límite **5 segundos** |
| <kbd>Ctrl</kbd> + <kbd>Flechas</kbd> | Desplazar cabezal/límite **1 segundo** |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Flechas</kbd> | Ajuste fino de **milisegundos (0.01s)** |

---

### 5. Historial de Descargas
- Guardado automático de las sesiones recientes en `localStorage`.
- Opción para recargar rápidamente videos previos o limpiar el historial.

---

## Estructura del Proyecto

```
YT-to-Audio/
├── backend/                # Servidor API Flask (Python)
│   ├── app.py              # Endpoints API (/extract, /progress, /process)
│   ├── requirements.txt    # Dependencias de Python
│   ├── temp_audio/         # Caché de audios originales descargados
│   └── processed_audio/    # Audios procesados listos para descarga
├── frontend/               # Interfaz Web Estática
│   ├── index.html          # Estructura principal y componentes modales
│   ├── css/
│   │   └── styles.css      # Estilos personalizados, temas oscuros y scrollbars
│   └── js/
│       └── main.js         # Lógica interactiva, WaveSurfer v7 y Web Audio API
├── .gitignore
└── README.md
```

---

## Requisitos del Sistema

- **Python 3.10+**
- **FFmpeg** (Debe estar instalado y agregado a las variables de entorno del sistema / `PATH`).

---

## Instalación

1. Clona el repositorio o descarga los archivos.
2. Crea e inicializa el entorno virtual de Python dentro de la carpeta `backend`:

```bash
cd backend
python -m venv venv
```

3. Activa el entorno virtual e instala las dependencias:

**En Windows (PowerShell / CMD):**
```bash
venv\Scripts\activate
pip install -r requirements.txt
```

**En Linux / macOS:**
```bash
source venv/bin/activate
pip install -r requirements.txt
```

---

## Modo de Uso

**1. Iniciar el Backend (Python / Flask):**
```bash
cd backend
python app.py
```
*(Escucha en `http://localhost:5050`)*

**2. Iniciar el Frontend (Servidor HTTP estático):**
```bash
cd frontend
python -m http.server 8000
```
*(Disponible en `http://localhost:8000`)*

**3. Abrir en el navegador:**
Abre `http://localhost:8000` en tu navegador web.

---

## Notas
- **Puerto del Backend**: `5050`
- **Puerto del Frontend**: `8000`
- **Descargas Temporales**: Los archivos en `temp_audio/` y `processed_audio/` se gestionan localmente en el servidor backend.
