# Catálogo — programa por programa

Verificado el **2026-11-05**. Los nombres de programas de pago aparecen aquí solo de forma descriptiva.

**Sobre las mediciones:** Chrome 152 en un solo equipo de 16 GB, red doméstica, con transferencia real. "Abre" significa que la interfaz cargó; **no se probaron todas las herramientas**.

## 1. Los 19 programas

| # | Programa de pago | Opción libre | Licencia | En ESTRELLA | Cobertura honesta |
|---|---|---|---|---|---|
| 1 | AutoCAD | LibreCAD web + MLightCAD | GPL-2.0 / MIT | Web | Dibujo 2D sí; automatización y ecosistema, no |
| 2 | SketchUp | OpenSCAD web; Blender o FreeCAD en escritorio | GPL-3.0 / LGPL-2.1 | Web parcial + escritorio | Paramétrico sí; modelado por empuje directo en web, no |
| 3 | Revit | FreeCAD BIM; visor IFC con web-ifc | LGPL-2.1 / MPL-2.0 | Visor web + escritorio | Ver IFC sí; flujo BIM colaborativo, no |
| 4 | Enscape | Blender EEVEE | Por confirmar | Escritorio | Depende de la GPU; no hay sincronía en vivo con BIM |
| 5 | V-Ray | Blender Cycles, LuxCore | Por confirmar / Apache-2.0 | Escritorio | Render de calidad, pero materiales incompatibles |
| 6 | 3ds Max | Blender | Por confirmar | Escritorio | Amplio; los plugins propios no funcionan |
| 7 | Illustrator | SVG-Edit; Inkscape en escritorio | MIT y mezcla / por confirmar | Web + escritorio | Vector básico en web; lo avanzado, en escritorio |
| 8 | Photoshop | miniPaint; Krita o GIMP en escritorio | MIT / GPL-3.0 | Web + escritorio | Capas y filtros sí; IA generativa y funciones avanzadas, no |
| 9 | InDesign | Scribus | Por confirmar | Escritorio | Maquetación sí; INDD no se abre |
| 10 | Acrobat | PDF.js + pdf-lib | Apache-2.0 / MIT | Web | Ver, anotar, unir, dividir. OCR y edición profunda: por evaluar |
| 11 | Lightroom | libraw-wasm para vista; darktable en escritorio | ISC / GPL-3.0 | Vista web + escritorio | Revelado completo solo en escritorio |
| 12 | Bridge | Gestor de archivos propio; digiKam | Propio / por confirmar | Web + escritorio | Organizar sí; catálogos enormes, no en web |
| 13 | Adobe Express | Plantillas propias sobre miniPaint o Excalidraw | Propio / MIT | Web | Sin banco de imágenes de pago |
| 14 | Rhino | FreeCAD; OpenSCAD web | LGPL-2.1 / GPL-3.0 | Escritorio | NURBS libres limitadas; Grasshopper no tiene equivalente directo |
| 15 | Blender | Blender | Por confirmar | Enlace al oficial | Ya es libre: solo se guía y se configura |
| 19 | Notion | Editor propio de apuntes | Propio | Web | Notas y tablas simples; no la plataforma completa |
| 20 | Autodesk Forma | QGIS + FreeCAD | GPL-2.0 / LGPL-2.1 | Escritorio | **El mayor hueco:** sin análisis urbano equivalente en web |
| 21 | Miro | Excalidraw | MIT | Web | Muy bueno; colaboración en vivo, en una fase posterior |
| 22 | Premiere Pro | Kdenlive, Shotcut | GPL-3.0 | Escritorio | Edición real sí; en navegador no se ofrece |

## 2. Componentes web medidos

| Componente | Estado | Descarga medida | Memoria JS al abrir | Navegadores | Exigencia |
|---|---|---|---|---|---|
| miniPaint | Estable; último commit 2026-04-19 | 354 KB | 6 MB | Falta probar fuera de Chrome | Baja |
| Excalidraw | Estable | 651 KB | 8 MB | Falta probar fuera de Chrome | Baja |
| OpenSCAD web | **Alfa** | 8,7 MB | 27 MB | Falta probar fuera de Chrome | Media |
| LibreCAD web | **Experimental** | **25,2 MB** | 33 MB (sin contar memoria WebAssembly) | **Solo Chrome/Edge 137+** | Media |
| FreeCAD web | **Experimental** | ~96 MB, según su autor; no medido | No medido | Solo Chrome/Edge 137+ | **Alta**: no apto para el equipo modesto |
| MLightCAD | Activo; `cad-editor` sigue en preview | Falta medir la app | No medido | Falta probar | Por medir |

Para comparar: el panel de ESTRELLA tiene como límite 300 KB.

## 3. Descartados

| Candidato | Motivo |
|---|---|
| Outline | BSL 1.1, no es código abierto |
| tldraw | Producción exige licencia |
| Stirling-PDF | Necesita servidor y tiene partes con otra licencia |
| AFFiNE | Licencia mixta y backend aparte |
| AppFlowy, Logseq, SiYuan | AGPL-3.0: viable, pero pesa más de lo que aporta en la primera versión |
| Penpot | MPL-2.0 válida, pero probablemente requiere servidor (por confirmar) |

## 4. Conversor: qué se puede prometer

| Formato | Biblioteca | Expectativa | Estado |
|---|---|---|---|
| DXF | MLightCAD | Abrir y ver | Probar en F4 |
| DWG | LibreDWG (GPL-3.0) en módulo aparte | Abrir con pérdidas posibles; archivos grandes pueden agotar memoria | Probar en F4 |
| PSD | ag-psd (MIT) | Capas y píxeles; efectos parciales | Probar en F4 |
| PDF, SVG, PNG, JPG, WebP | PDF.js, navegador | Bien | Probar en F4 |
| RAW | libraw-wasm (ISC) | Vista previa | Probar en F4 |
| OBJ, STL, 3MF | three.js (MIT) | Ver | Probar en F4 |
| IFC | web-ifc (MPL-2.0) | Ver | Probar en F4 |
| AI | PDF.js | Solo si el archivo guarda una copia PDF | Probar en F4 |
| SKP | Sin lector web comprobado | **No se promete** | Investigar |
| INDD | Sin lector libre encontrado | **No se promete.** Aviso: pide un PDF o IDML | Mensaje honesto |
