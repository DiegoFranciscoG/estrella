# ESTRELLA en el escritorio y el teléfono

ESTRELLA se instala de dos formas, y las dos muestran la misma aplicación web y guardan los mismos datos.

| | App web instalable (PWA) | ESTRELLA para Windows |
|---|---|---|
| Dónde | Android, iPhone y iPad, Windows, Mac y Linux | Windows 10 (1903 o posterior) y Windows 11 |
| Cómo | Desde el navegador: página «Instalar» (`#/instalar`) | Un archivo `ESTRELLA.exe` de 1,3 MB |
| Se actualiza | Sola. Una versión nueva espera hasta que el estudiante pulsa «Actualizar», y antes se guarda lo abierto | La web se actualiza sola; el programa, con un `ESTRELLA.exe` nuevo |
| Sin conexión | El panel siempre; cada programa, después de abrirlo una vez con internet | Igual |
| Extra | — | Instala los programas libres de escritorio de la guía (FreeCAD, Blender, GIMP…) con winget, desde su fuente oficial |
| Firma | No hace falta | Sin firma: Windows avisa la primera vez (ver abajo) |

## App web instalable

- **Manifiesto:** `frontend/public/manifest.webmanifest`. Íconos PNG de 192 y 512 px, *maskable* y de Apple, generados con `node scripts/make-icons.mjs`.
- **Dos service workers**, escritos por el build con la lista exacta de archivos y una versión:
  - `sw.js` (panel): guarda el panel entero al instalarse. La página principal se pide primero a la red; los archivos con hash, primero a la copia. La API nunca se guarda.
  - `apps/sw.js` (programas, en su propio sitio): guarda cada programa la primera vez que se abre. Con cada versión nueva borra los archivos que ya no existen.
- **Almacenamiento persistente:** después de guardar trabajo, se pide `navigator.storage.persist()`, salvo en Firefox, donde aparecería un aviso fuera de contexto. El medidor de recursos muestra el estado y tiene un botón para pedirlo.

## ESTRELLA para Windows

Código: `desktop/windows/`. Es .NET Framework 4.8 con WebView2, que ya vienen con Windows, en un solo archivo: las bibliotecas de WebView2 van dentro del `.exe`.

**Compilar**

```bash
cd desktop/windows
dotnet build Estrella.Desktop -c Release -p:EstrellaUrl=https://tu-dominio
```

Sin `EstrellaUrl`, una compilación de Release falla a propósito. En Debug apunta a `http://localhost:8088` (docker compose).

**Pruebas**

```bash
dotnet test --project Estrella.Desktop.Tests
```

Cubren la política de navegación, la lista cerrada de programas (y que coincide con la guía), las rutas y el registro de instalación, y que WebView2 viaja dentro del `.exe`.

La prueba real de instalar, actualizar y desinstalar sin perder datos usa la app de verdad en el equipo. Necesita Windows y `docker compose up`, y deja el equipo como estaba:

```bash
cd frontend && npm run e2e:desktop
```

**Qué hace en el equipo** (por usuario, sin permisos de administrador)

| Qué | Dónde |
|---|---|
| Programa y avisos de licencias | `%LOCALAPPDATA%\Programs\ESTRELLA\` |
| Datos del estudiante (perfil de WebView2: proyectos, sesión) | `%LOCALAPPDATA%\ESTRELLA\` |
| Acceso directo | Menú Inicio |
| Entrada en Configuración > Aplicaciones | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\ESTRELLA` |

- **Actualizar:** se reemplaza solo el programa.
- **Desinstalar:** se borran el programa, el acceso y la entrada. Los datos quedan, salvo que el estudiante marque "Borrar también mis datos".
- **Sin preguntas** (scripts o soporte técnico): `ESTRELLA.exe --install --silent` y `ESTRELLA.exe --uninstall --silent [--delete-data]`.

**Seguridad**

Sigue la guía de Microsoft "Develop secure WebView2 apps":

- **Navegación:** la ventana solo va a páginas HTTPS (o a este equipo, en desarrollo). Los enlaces que abren otra ventana van al navegador del estudiante, y `file:`, `javascript:` y los protocolos del sistema se bloquean. Fuera de ESTRELLA, una barra dice en qué sitio está y ofrece volver.
- **Puente:** sin objetos del host. Hay un solo mensaje, «instalar el programa X de la guía», que se acepta solo si viene de ESTRELLA. El programa sale de una lista cerrada, y el estudiante confirma en una ventana nativa antes de que corra winget.
- **Permisos:** cámara, micrófono, ubicación y notificaciones se niegan siempre.
- **Desarrollo:** las herramientas de desarrollo están apagadas en Release.

**Firma**

El `.exe` no está firmado. Firmar fuera de la Microsoft Store cuesta entre USD 150 y 400 al año, y Azure Artifact Signing no está disponible para personas en Ecuador. Windows mostrará «Windows protegió tu PC» y el estudiante debe elegir «Más información» > «Ejecutar de todas formas». La vía gratis es la Microsoft Store: cuenta sin costo y firma incluida. Decidirlo y publicarlo te corresponde a ti.

**Publicar una versión**

1. Compila en Release con la dirección real.
2. Sube `ESTRELLA.exe` a GitHub Releases.
3. Pon su enlace en `frontend/src/data/contacto.json` (`windowsInstaller`): la página «Instalar» mostrará el botón de descarga.
