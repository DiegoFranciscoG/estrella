# Licencias

Verificado el **2026-11-05**. El detalle de cada obligación debe revisarse contra el texto de cada licencia antes de publicar; un abogado debe confirmarlo si el proyecto llega a ser comercial.

## 1. Qué obliga cada una

| Licencia | Componentes | Obligación al servirlo por internet |
|---|---|---|
| MIT / ISC | miniPaint, Excalidraw, MLightCAD, ag-psd, pdf-lib, three.js, libraw-wasm, SVG-Edit (núcleo) | Conservar copyright y aviso |
| Apache-2.0 | PDF.js, LuxCore | Conservar licencia y avisos; indicar cambios |
| MPL-2.0 | web-ifc | Publicar los cambios a sus archivos |
| LGPL-2.1 | FreeCAD | Aviso y fuente de la biblioteca; permitir sustituirla. Con enlace estático el cumplimiento es más delicado |
| GPL-2.0 | LibreCAD, libdxfrw | Ofrecer la fuente exacta del binario servido, con avisos |
| GPL-3.0 | LibreDWG, OpenSCAD web, Krita, darktable, Kdenlive, Shotcut, RawTherapee | Igual, con los requisitos adicionales de GPLv3 |
| Por confirmar | Blender, GIMP, Inkscape, Scribus, digiKam | Leer su licencia antes de incluirlos en el instalador |

## 2. Riesgos concretos

1. **LibreCAD y LibreDWG no se deben enlazar en un mismo módulo.** LibreCAD declara GPL versión 2 y LibreDWG GPL-3.0. Irán en programas separados; DWG en LibreCAD usa libdxfrw.
2. **Código de ESTRELLA:** puede ser MIT si cada programa GPL corre aparte, en su propio marco y sin mezclar código. Por eso el aislamiento también es una decisión legal. Si se modifica un programa GPL, esas modificaciones siguen siendo GPL.
3. **Fuente exacta:** cada binario GPL servido necesita, junto a él, un enlace a la fuente de esa misma versión y sus scripts de compilación. Enlazar solo al proyecto original no basta si hay cambios.
4. **`svgedit` en npm** declara una mezcla que incluye LGPL-3.0. La lista de avisos debe salir del árbol real de dependencias.
5. **`@ffmpeg/core`** es GPL y no se incluye en la primera versión.
6. **Marcas de los proyectos libres:** "LibreCAD", "Blender" y similares también pueden ser marcas. Se usan solo para decir qué programa es, nunca como nombre de ESTRELLA. El uso exacto de la marca de Blender debe leerse antes de publicar.
7. **Datos de plantillas y fuentes:** cada fuente tipográfica, plantilla o ícono incluido necesita licencia comprobada.

## 3. Lo que se distribuye desde la fase 3

| Componente | Versión | Licencia | Cómo llega |
|---|---|---|---|
| Excalidraw | 0.18.1 | MIT | npm, compilado en Pizarra |
| React / React DOM | 19.3.1 | MIT | npm |
| PDF.js (`pdfjs-dist`) | 6.5.438 | Apache-2.0 | npm, compilado en Folio |
| pdf-lib | 1.17.1 | MIT | npm |
| dxf-parser | 1.1.2 | MIT | npm, compilado en Plano |
| miniPaint | 4.14.3 | MIT | copia en `frontend/apps/static/lienzo/vendor/`; único cambio: se quitaron las llaves de API de su autor |

En total se publican 265 paquetes, todos con licencias permitidas. El archivo `THIRD-PARTY-NOTICES.txt` se genera en cada compilación y queda enlazado desde la página de licencias.

## 4. Lo que se agrega en la fase 4 (Visor)

| Componente | Versión | Licencia | Cómo llega |
|---|---|---|---|
| three.js | 0.186.1 | MIT | npm, compilado aparte; se baja al abrir un modelo 3D |
| ag-psd (y pako, base64-js) | 31.0.3 | MIT | npm; se baja al abrir un PSD |
| web-ifc | 0.0.78 | MPL-2.0 | npm, sin modificar; su wasm se sirve con nombre versionado |
| @mlightcad/libredwg-web (LibreDWG) | 0.7.5 | **GPL-3.0** | npm, sin modificar; solo dentro del worker de DWG |

**Cómo se cumple la GPL del lector de DWG:**

1. **Programa aparte:** corre en su propio Web Worker y Visor solo le pasa bytes y recibe un SVG o un DXF por mensajes. El worker completo (el envoltorio GPL más `cad-bounds.ts`, que es MIT y compatible) se distribuye bajo GPL-3.0. El resto de ESTRELLA sigue siendo MIT.
2. **Licencia y fuente junto al binario:** `/apps/visor/licencias/` publica el texto de la GPL-3.0, el de la MPL-2.0 de web-ifc y `SOURCE.txt` con la versión, el hash del wasm, el tarball de npm y la etiqueta exacta del código fuente (v0.7.5, commit `5144ff4`).
3. **Control T-02:** el script de licencias acepta GPL solo para paquetes de la lista `ISOLATED_GPL`, con el motivo escrito. Cualquier otro paquete GPL rompe la compilación (así detectó este).

**Pendiente antes de publicar (SUPUESTO legal):** hoy la fuente se ofrece enlazando al repositorio del autor. La GPL-3.0 (sección 6) pide que la fuente siga disponible mientras se distribuya el binario; un enlace a un servidor ajeno puede desaparecer. Antes de "VOY A SUBIR", conviene guardar una copia del código fuente de esa etiqueta junto a la publicación (por ejemplo, como archivo de la versión en GitHub).

## 5. Lo que se agrega en la fase 10 (programas propios)

| Programa | Componentes de terceros | Obligación |
|---|---|---|
| Trazo, Revelado, Archivo, Análisis de sitio | Ninguno: código propio (MIT). Revelado y Archivo reutilizan el lector de vistas previas RAW de Visor, también propio | Ninguna adicional |
| Sólido | three.js 0.186.1 (MIT), el mismo de la fase 4 | Conservar copyright y aviso: ya están en `THIRD-PARTY-NOTICES.txt` |
| BIM | web-ifc 0.0.78 (MPL-2.0) y three.js 0.186.1 (MIT), sin modificar, los mismos archivos que usa Visor | Mismas que en la fase 4: avisos en `THIRD-PARTY-NOTICES.txt`, texto de la MPL-2.0 en `/apps/visor/licencias/` y enlace al código fuente en la página de licencias |

No se agregó ninguna dependencia nueva: T-02 sigue en verde (271 paquetes distribuidos, todos con licencia permitida).

## 6. Controles obligatorios

- Lista permitida: MIT, ISC, BSD, Apache-2.0, MPL-2.0, LGPL, GPL (solo programas aislados).
- Lista prohibida: BSL, SSPL, licencias "source available", licencias propias que exijan clave.
- Prueba T-02: falla si entra una licencia no permitida.
- Archivo de avisos generado en cada compilación y página de licencias en el pie.
