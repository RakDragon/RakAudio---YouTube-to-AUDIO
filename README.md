# RakAudio - YouTube to AUDIO

> Herramienta profesional y moderna para descargar, previsualizar en tiempo real, editar y procesar pistas de audio de YouTube con espacialización **8D Audio HRTF**, procesamiento DSP avanzado y renderizado de alta fidelidad.

---

## 🌟 Características Principales

### 1. Extracción y Descarga de Audio en Alta Calidad
- **Descarga directa** desde cualquier enlace de YouTube o YouTube Shorts mediante `yt-dlp` y `FFmpeg`.
- **Múltiples formatos de exportación profesional**:
  - `MP3` (MPEG Layer-3)
  - `M4A` (AAC en contenedor MP4)
  - `WAV` (PCM sin compresión)
  - `FLAC` (Free Lossless Audio Codec)
  - `AAC` (Advanced Audio Coding)
  - `OPUS` (Códec interactivo de alta eficiencia)
- **Selector de tasa de bits (Bitrate)**: Desde `128 kbps` hasta `320 kbps` (o bitrate máximo nativo para formatos sin pérdida).
- **Extracción completa de metadatos**: Título, canal/artista, número de reproducciones, fecha de subida, duración y carátula/miniatura en alta resolución con fondo dinámico blur.
- **Progreso en tiempo real**: Notificaciones inmediatas del estado de descarga y conversión mediante *Server-Sent Events* (SSE).

---

### 2. Espacialización Avanzada 8D Audio (HRTF 3D)
Convierte cualquier pista estéreo convencional en una experiencia inmersiva envolvente de 360 grados para auriculares:
- **Motor Binaural HRTF**: Cálculo dinámico de retardo interaural de tiempo (ITD) y diferencia interaural de nivel (ILD) con `PannerNode` en modo `HRTF`.
- **Sombreado Psicoacústico de Cabeza (Pinna / Head-Shadow Effect)**: Filtro dinámico de paso bajo que simula el bloqueo físico del pabellón auditivo cuando la fuente sonora se desplaza detrás del oyente (22 kHz al frente $\to$ 7.5 kHz detrás).
- **Acústica de Sala y Espacio Tridimensional**: Reverberación convolutiva suave con respuesta de impulso calibrada y rampa de ataque de 15 ms que añade profundidad espacial sin picos transitorios.
- **Limitador Maestro de Estudio Anti-Clipping (`DynamicsCompressorNode`)**: Etapa de compresión y limitación que garantiza cero distorsión digital, golpeteos o chasquidos (*pops/clicks*), tanto en la reproducción en vivo como en el archivo descargado.
- **3 Patrones de Órbita 3D**:
  - `Circular (360° estándar)`: Órbita esférica continua alrededor del oyente con sutil componente de elevación.
  - `Elíptica (Achatada)`: Barrido lateral con mayor separación estéreo en los ejes izquierdo/derecho.
  - `Figura en 8 (Oscilación)`: Trayectoria en bucle infinito con cruces frontales y traseros.
- **Selector de Dirección de Giro**:
  - `Izquierda ➔ Derecha`: El sonido viaja desde el flanco izquierdo a través del frente hacia la derecha.
  - `Derecha ➔ Izquierda`: El sonido viaja desde el flanco derecho a través del frente hacia la izquierda.
- **Parámetros Personalizables**: Tiempo de vuelta (velocidad de 4s a 20s) y radio de distancia (0.5m a 5.0m).
- **Radar Visual Interactivo en Tiempo Real**:
  - Visualizador en `<canvas>` integrado con la silueta de la cabeza del oyente.
  - Permite arrastrar el orbe sonoro con el ratón o pantalla táctil para posicionar manualmente la fuente de audio en cualquier ángulo espacial en vivo.

---

### 3. Previsualización y Ajustes Globales
- **Onda Espectral Interactiva**: Visualización de audio de alta precisión impulsada por `WaveSurfer.js v7`.
- **Alternador de Vista en Vivo (Original vs. Editado)**:
  - **Original**: Reproducción limpia del audio crudo extraído con control de volumen independiente.
  - **Editado**: Previsualización instantánea de todos los efectos combinados (recortes, fades, 8D, pitch, tempo, volumen manual, normalización y reversa) sin requerir re-procesamientos pesados en el servidor.
  - **Transición sin saltos**: Sincronización continua de tiempo al alternar entre vistas.
- **Controles de Transporte**: Play/Pausa, rebobinar/avanzar 5s, 10s, salto a inicio/final.

---

### 4. Panel "MÁS HERRAMIENTAS" (Suite de Edición)
- **Recorte Preciso de Audio**:
  - Selección de intervalos mediante tiradores interactivos sobre el espectrograma.
  - Botón **"Escuchar Selección"** con indicador de progreso integrado en el fondo (*fill progresivo*).
- **Transiciones Fade In / Fade Out**:
  - Curvas de entrada y salida configurables en segundos con proyección visual sombreada sobre la onda espectral.
- **Ajustes de Audio DSP**:
  - **Ajuste de Volumen Manual**: Ganancia limpia de 0% a 200%.
  - **Velocidad (Tempo)**: Variación de 0.25x a 4.00x en tiempo real.
  - **Cambio de Tono (Pitch)**: Modificación de tono de -12 a +12 semitonos.
  - **Normalización EBU R128**: Nivelación estándar de sonoridad para transmisiones (+3.5 dB de ganancia perceptiva).
  - **Invertir Audio (Audio Reverse)**: Reproducción y exportación en reversa de fin a inicio con inversión gráfica del espectrograma (*Spectrum Flip*).

---

### 5. Renderizado de Exportación de Alta Fidelidad (100% Fidelity)
- **Pipeline de Audio Offline**: Procesamiento de precisión de 32 bits en punto flotante con `OfflineAudioContext` que replica exactamente cada modulación de paneo 8D, filtro, fade y ganancia escuchada en la previsualización.
- **Codificador WAV 16-bit con Soft-Limiting**: Conversor nativo a PCM de 16 bits con curva de saturación suave `Math.tanh()` para evitar cortes duros a 0 dBFS antes de la conversión final en `FFmpeg`.

---

### 6. Atajos de Teclado y Accesibilidad

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

### 7. Historial de Sesiones
- Registro automático de los últimos audios consultados en `localStorage`.
- Recarga rápida de metadatos o vaciado seguro del historial con un solo clic.

---

## 🏗️ Arquitectura del Proyecto

```
YT-to-Audio/
├── backend/                # Servidor API Flask (Python)
│   ├── app.py              # Endpoints REST (/extract, /progress, /process), limpieza de disco y SSE
│   ├── requirements.txt    # Dependencias de Python (Flask, yt-dlp, flask-cors)
│   ├── temp_audio/         # Almacenamiento temporal de pistas originales descargadas
│   └── processed_audio/    # Almacenamiento temporal de audios procesados listos para descarga
├── frontend/               # Aplicación Web Frontend (SPA)
│   ├── index.html          # Estructura semántica, modal de herramientas y componentes UI
│   ├── css/
│   │   └── styles.css      # Sistema de diseño, animaciones, temas oscuros y scrollbars
│   └── js/
│       └── main.js         # Motor Web Audio API 8D, WaveSurfer v7, listeners y exportación
├── .gitignore
└── README.md
```

---

## 📋 Requisitos del Sistema

- **Python 3.10 o superior**
- **FFmpeg** instalado y accesible globalmente en el `PATH` del sistema.
- **Navegador Web Moderno** (Google Chrome, Microsoft Edge, Firefox, Brave) con soporte para Web Audio API y HRTF Panning.

---

## 🚀 Instalación y Puesta en Marcha

### 1. Clonar el repositorio
```bash
git clone https://github.com/RakDragon/RakAudio---YouTube-to-AUDIO.git
cd RakAudio---YouTube-to-AUDIO
```

### 2. Configurar el Backend (Python)
```bash
cd backend
python -m venv venv
```

**Activar el entorno virtual:**
- **Windows (PowerShell / CMD):**
  ```powershell
  venv\Scripts\activate
  ```
- **Linux / macOS:**
  ```bash
  source venv/bin/activate
  ```

**Instalar dependencias:**
```bash
pip install -r requirements.txt
```

**Iniciar el servidor backend:**
```bash
python app.py
```
> El servidor Flask estará escuchando en `http://localhost:5050`

---

### 3. Iniciar el Frontend
En otra terminal (desde la carpeta raíz del proyecto):
```bash
cd frontend
python -m http.server 8000
```
> El frontend estará disponible en `http://localhost:8000`

---

### 4. Abrir en el Navegador
Accede a [http://localhost:8000](http://localhost:8000) desde tu navegador web, pega el enlace de un video de YouTube y comienza a editar.

---

## 🛡️ Licencia y Créditos
Desarrollado con ❤️ para procesamiento de audio avanzado y espacialización 3D.
