# Seguridad: auditoría OWASP

Revisión de cierre (F9, 2026-11-07) contra tres listas de OWASP:

- [Top 10:2025](https://top10.owasp.org/2025)
- [API Security Top 10:2023](https://api-security.owasp.org/editions/2023/en/0x11-t10)
- [Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)

Cada control lleva su evidencia, casi siempre una prueba automática que corre en CI. Los nombres de prueba son métodos de `backend/src/test/...` o archivos de `frontend/tests/...`.

## Lo esencial del diseño

- **El servidor no puede leer el trabajo de nadie.**
  - El dispositivo deriva de la contraseña una `authKey` y una llave que nunca sale del equipo (PBKDF2-SHA256 de 600 000 iteraciones, luego HKDF). Con esa llave cifra nombres y contenido con AES-GCM.
  - El servidor recibe la `authKey` y la guarda con Argon2id (19 MiB, t=2, p=1).
- **Denegar por defecto**: toda ruta exige sesión, salvo una lista explícita (`SecurityConfig.PUBLIC_POSTS` y `PUBLIC_GETS`).
- **Secretos solo por variables de entorno**, sin valores por defecto. Si falta uno, la API no arranca.
- **Dos sitios**: el panel y los programas viven en orígenes distintos. Cada programa corre en un `iframe` aislado y solo habla con el panel por mensajes de origen verificado.
- **Los archivos del estudiante no salen de su equipo.** Cada programa los lee en el navegador, con límites (IFC de 200 MB, GeoJSON de 20 MB, fotos de 36 MP), y valida campo por campo cada documento guardado antes de usarlo. Los SVG ajenos solo se muestran dentro de `<img>`, donde no ejecutan scripts, y el texto de los archivos (nombres en un IFC, propiedades) entra al DOM con `textContent`.
- **WebAssembly solo donde hace falta:** `'wasm-unsafe-eval'` está permitido únicamente en `/apps/visor/`, `/apps/bim/` y en los workers; permite compilar el wasm del propio sitio, no ejecutar `eval()`.

## OWASP Top 10:2025

| Categoría | Controles | Evidencia |
|---|---|---|
| **A01 Broken Access Control** | El usuario sale siempre del `sub` del JWT, nunca de la petición. Consentimientos separados para sincronizar y para el asistente. CORS solo con orígenes de `APP_CORS_ORIGINS`. Detrás de Netlify, solo pasan las peticiones firmadas por el proxy | `oneAccountNeverReachesAnothersProjects`, `syncNeedsItsOwnConsent`, `corsAllowsOnlyConfiguredOrigins`, `theDocumentedSessionRuleIsTheRealOne`, `onlyRequestsSignedByThePanelsProxyReachTheApi` |
| **A02 Security Misconfiguration** | Cabeceras estrictas y una CSP por tipo de recurso, sin `unsafe-inline`; `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y COOP. Actuator solo expone `health`. Swagger está apagado en producción. Errores sin trazas | `responsesCarrySecurityHeaders`, `apiDocsAreNotPublishedByDefault`, `malformedJsonDoesNotLeakDetails`; comparación de los 511 archivos de nginx con las cabeceras generadas para Netlify (`tests/unit/netlify.test.ts`) |
| **A03 Software Supply Chain Failures** | Versiones exactas: `package-lock.json` con `npm ci`, Maven, imágenes Docker con versión fija y acciones de GitHub fijadas por SHA. gitleaks en cada commit y en CI. Los programas se sirven desde el propio sitio, sin CDN. La app de Windows instala solo una lista cerrada de winget, con su hash verificado | `npm audit`: 0 vulnerabilidades. OSV: 0 en las 103 dependencias Maven de ejecución (2026-11-07). Las imágenes Docker no se escanearon (ver riesgos) |
| **A04 Cryptographic Failures** | AES-256-GCM con datos asociados para las claves de OpenRouter guardadas. JWT HS256 con secreto de al menos 256 bits. TLS en todos los servicios publicados; Neon con *channel binding* | `opensOnlyForItsOwnerAndWithItsSecret`, `shortJwtSecretStopsTheApplication`, `theKeyIsStoredOnlyEncryptedAndTheProxyAddsIt`; `tests/unit/crypto.test.ts` |
| **A05 Injection** | SQL siempre con parámetros (`JdbcClient`). El DOM se arma con `textContent`, nunca `innerHTML`, y la CSP prohíbe scripts en línea. Los correos HTML escapan todo y solo enlazan al propio sitio. Las exportaciones CSV (BIM, Archivo, Análisis de sitio) anteponen `'` a las celdas que empiezan como fórmula, según OWASP (CSV Injection) | `theHtmlVersionEscapesEverythingAndLinksOnlyToThisSite`, `invalidInputIsRejectedWithFieldNamesOnly`; `frontend/src/ui/dom.ts`; «writes a CSV that spreadsheets read and that cannot run formulas» (`tests/unit/bim.test.ts`) |
| **A06 Insecure Design** | Cifrado de extremo a extremo y versiones con `If-Match`, para que dos equipos nunca se pisen. Respuestas idénticas para cuentas existentes e inexistentes. La app nunca repite una escritura mientras la API despierta | `registeringAnExistingEmailLooksIdenticalFromOutside`, `unknownEmailAndWrongPasswordGetTheSameAnswer`, `anOlderBaseVersionNeverOverwritesANewerOne`; `tests/unit/misc.test.ts` |
| **A07 Authentication Failures** | Frenos progresivos por correo y dirección, por cuenta (independiente de la IP) y por dirección. Correo verificado antes de entrar. El token de acceso dura 15 minutos y vive solo en memoria. La cookie de renovación es `HttpOnly`, `Secure` y `SameSite`, y rota en cada uso; reutilizar una vieja cierra todas las sesiones. Hay aviso de nuevo inicio de sesión | `repeatedFailuresLockTheLoginProgressively`, `guessingOneAccountStaysSlowFromManyAddresses`, `refreshRotatesAndReuseRevokesEverySession`, `verificationLinkWorksOnlyOnce`, `anAddressWrittenByTheClientIsIgnored`, `loginBrakesFollowTheStudentNotTheProxy` |
| **A08 Software or Data Integrity Failures** | Cada versión cifrada viaja con su SHA-256 (`X-Content-SHA256`), y AES-GCM detecta cualquier cambio. Los service workers sirven solo archivos de su build, por versión. El contrato `docs/openapi.json` se compara con el código en cada build | `uploadsVersionsAndDownloadsExactlyTheSameBytes`, `rejectsDamagedTooSmallAndTooLargeContent`, `theCommittedContractMatchesTheCode`; `tests/e2e/pwa.spec.ts` |
| **A09 Security Logging and Alerting Failures** | Se registran los eventos de seguridad (frenos de inicio de sesión, reutilización de un token de renovación, firma del proxy) sin correos, IP ni tokens, por la LOPDP | `AuthService` y `TokenService` («Security event: …»). No hay alertas automáticas: ver riesgos |
| **A10 Mishandling of Exceptional Conditions** | Todo error sale como RFC 9457 con un `code` estable y sin detalles internos. Un correo que falla nunca rompe la petición. Los errores de OpenRouter se traducen y nunca devuelven 401 al panel. Los cuerpos JSON sin tamaño o gigantes se cortan antes de leerlos | `malformedJsonDoesNotLeakDetails`, `jsonBodiesHaveASizeLimit`, `openRouterErrorsReachTheStudentInPlainWords`, `emailsCarryTheLinkAndTheSignatureAndAFailedDeliveryNeverBreaksTheRequest` |

## OWASP API Security Top 10:2023

| Categoría | Controles | Evidencia |
|---|---|---|
| **API1 Broken Object Level Authorization** | Cada consulta filtra por el usuario del token. Un proyecto ajeno responde igual que uno inexistente | `oneAccountNeverReachesAnothersProjects` |
| **API2 Broken Authentication** | Igual que A07. Además, la dirección del cliente sale de proxies de confianza, no de lo que escriba el cliente | `anAddressWrittenByTheClientIsIgnored`, `requestsThatDidNotComeThroughThePanelAreRefused` |
| **API3 Broken Object Property Level Authorization** | DTO con campos explícitos (records). La exportación de datos no incluye contenido. La clave de OpenRouter nunca vuelve al navegador | `exportsPersonalDataWithoutAnyContent`, `theKeyIsStoredOnlyEncryptedAndTheProxyAddsIt` |
| **API4 Unrestricted Resource Consumption** | Límites por recurso: JSON de 128 KB, foto de 256 KB, versión cifrada de 10 MB, 25 MiB por estudiante, 500 proyectos, 60 subidas por minuto. El asistente: 6 preguntas por minuto, una a la vez, mensaje y respuesta con tope | `jsonBodiesHaveASizeLimit`, `outOfSpaceMakesRoomWithOldVersionsOrChangesNothing`, `askingNeedsAConnectionAndStaysWithinLimits`, `oneQuestionAtATime` |
| **API5 Broken Function Level Authorization** | No hay funciones de administración en la API. La documentación, cuando está encendida, es de solo lectura | `theDocsAreReadOnly` |
| **API6 Unrestricted Access to Sensitive Business Flows** | Correos limitados por buzón, por dirección (cabe un aula) y con un techo global por hora | `emailSendingEndpointsAreRateLimitedPerInbox`, `emailSendingEndpointsAllowAClassroomPerAddressButNotMore`, `emailsPerHourHaveACeilingForEveryone` |
| **API7 Server Side Request Forgery** | La API solo llama a destinos fijos de la configuración (OpenRouter y Brevo), nunca a URL que mande el cliente | `AppProperties` valida las URL al arrancar |
| **API8 Security Misconfiguration** | Igual que A02. Además, cookies `Secure` en producción y secretos obligatorios en `docker-compose.yml` (`${VAR:?}`) | `responsesCarrySecurityHeaders`, `eachTransportRefusesToStartWithoutItsSettings` |
| **API9 Improper Inventory Management** | Contrato OpenAPI generado del código, comparado en CI con `docs/openapi.json`, más una prueba de que cada ruta servida está documentada. OWASP pide que la documentación solo la vean quienes usan la API: en producción está apagada. `docs/despliegue.md` lista hosts, versiones y quién llega a cada uno | `everyRouteTheServerAnswersIsDocumented`, `theCommittedContractMatchesTheCode` |
| **API10 Unsafe Consumption of APIs** | Llamadas a OpenRouter con tiempo de espera (`APP_AI_TIMEOUT`, 20 s en producción) y a Brevo con 10 s. De Brevo solo se usa el código de estado. Solo se aceptan modelos `:free` de una lista cerrada; un modelo de pago no deja arrancar la API | `onlyFreeModelsAreAccepted`, `openRouterErrorsReachTheStudentInPlainWords`, `aRefusalFromBrevoIsReportedWithoutPersonalData` |

## OWASP Top 10 for LLM Applications 2025

| Categoría | Controles |
|---|---|
| **LLM01 Prompt Injection** | El asistente no tiene herramientas ni acceso a datos: solo recibe el texto que el estudiante revisó y envió. Una inyección no puede leer ni cambiar nada |
| **LLM02 Sensitive Information Disclosure** | El estudiante ve exactamente qué se enviará y a dónde antes de enviarlo. Por defecto se pide a OpenRouter que el proveedor no guarde datos (`data_collection: deny`) |
| **LLM03 Supply Chain** | Modelos de una lista cerrada en la configuración, y solo gratuitos |
| **LLM04 Data and Model Poisoning** | No se entrena ni se ajusta ningún modelo, y no hay base de conocimiento que envenenar |
| **LLM05 Improper Output Handling** | La respuesta se muestra como texto (`textContent`), nunca como HTML. La CSP prohíbe scripts en línea |
| **LLM06 Excessive Agency** | Sin herramientas, sin acciones y sin acceso a proyectos o cuentas |
| **LLM07 System Prompt Leakage** | Las instrucciones (`AiService.INSTRUCTIONS`) no contienen secretos ni reglas de acceso; filtrarlas no da nada |
| **LLM08 Vector and Embedding Weaknesses** | No aplica: no hay RAG ni base vectorial |
| **LLM09 Misinformation** | Cada respuesta dice qué modelo respondió y que «puede equivocarse: compárala con la Guía o con el manual oficial» |
| **LLM10 Unbounded Consumption** | Cada estudiante usa su propia cuenta gratuita de OpenRouter. Con 6 preguntas por minuto, una a la vez y topes de entrada y salida, nadie consume a costa de otro |

Pruebas de esta sección: `AiAssistantIntegrationTest`, `AiKeyCipherTest` y `tests/e2e/assistant.spec.ts`.

## Riesgos que quedan

| Riesgo | Mitigación actual | Qué haría después |
|---|---|---|
| Netlify no documenta qué cabecera lleva la IP del visitante | Solo se confía en ella con la firma válida, y la fuente queda en el registro (`docs/despliegue.md`, paso 8) | Confirmarla en el primer despliegue |
| Imágenes Docker sin escanear (sin trivy en este equipo; Docker Scout no respondió) | Imágenes oficiales con versión fija, JRE y nginx sin privilegios | Escanear con trivy en CI |
| Sin alertas automáticas | Eventos de seguridad en los registros de Render | Alertas cuando el plan lo permita |
| El token de acceso vale hasta 15 minutos después de salir | Vive solo en memoria; renovación con rotación y detección de reutilización | Lista de revocación si crece el riesgo |
| Dependencias que envejecen | Versiones fijas y auditorías manuales | Dependabot o Renovate con revisión humana |
| `ESTRELLA.exe` sin firma | SmartScreen avisa; la página «Instalar» lo explica | Publicar en la Microsoft Store (firma gratis) |

Para reportar una vulnerabilidad, ver [SECURITY.md](../SECURITY.md).
