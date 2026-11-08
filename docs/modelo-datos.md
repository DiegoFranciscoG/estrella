# Modelo de datos

El servidor guarda lo mínimo. El contenido de los proyectos llega cifrado y **los nombres de proyecto también**: así el servidor no conoce ni el título del trabajo. Esto va un paso más allá del documento original, que dejaba el nombre visible.

Migraciones en `backend/src/main/resources/db/migration/`:

- `V1__init.sql`: cuentas y proyectos.
- `V2__project_sync.sql` (fase 6): bytes cifrados, época de sincronización y restricciones.
- `V3__ai_assistant.sql` (fase 7): conexión con OpenRouter y su consentimiento.

```mermaid
erDiagram
    USER_ACCOUNT ||--o{ USER_SESSION : abre
    USER_ACCOUNT ||--o{ EMAIL_TOKEN : recibe
    USER_ACCOUNT ||--o{ CONSENT_RECORD : otorga
    USER_ACCOUNT ||--o{ PROJECT : posee
    USER_ACCOUNT ||--o{ PROGRAM_STATE : registra
    USER_ACCOUNT ||--o| AI_CONNECTION : conecta
    PROJECT ||--o{ PROJECT_VERSION : conserva
    PROJECT_VERSION ||--|| PROJECT_BLOB : guarda

    USER_ACCOUNT {
        uuid id PK
        citext email UK
        text password_hash
        timestamptz email_verified_at
        bytea wrapped_key_password
        bytea wrapped_key_recovery
        bytea key_salt
        bytea avatar
        bigint storage_used_bytes
        bigint storage_quota_bytes
        uuid sync_epoch
    }
    USER_SESSION {
        uuid id PK
        uuid user_id FK
        bytea refresh_token_hash UK
        timestamptz expires_at
        timestamptz revoked_at
    }
    EMAIL_TOKEN {
        uuid id PK
        uuid user_id FK
        text purpose
        bytea token_hash UK
        timestamptz expires_at
        timestamptz used_at
    }
    CONSENT_RECORD {
        uuid id PK
        uuid user_id FK
        text purpose
        text notice_version
        timestamptz granted_at
        timestamptz revoked_at
    }
    PROJECT {
        uuid id PK
        uuid user_id FK
        text program_id
        bytea encrypted_name
        bigint current_version
        timestamptz created_at
        timestamptz updated_at
    }
    PROJECT_VERSION {
        uuid id PK
        uuid project_id FK
        bigint version
        text storage_key UK
        bigint size_bytes
        bytea nonce
        bytea sha256
    }
    PROJECT_BLOB {
        text storage_key PK
        bytea data
    }
    PROGRAM_STATE {
        uuid user_id PK
        text program_id PK
        timestamptz thanks_seen_at
    }
    AI_CONNECTION {
        uuid user_id PK
        bytea key_nonce
        bytea key_ciphertext
        timestamptz created_at
        timestamptz last_used_at
    }
```

## Reglas y su origen

| Regla | Campo o restricción | Origen |
|---|---|---|
| Solo correo y contraseña; sin teléfono, cédula ni nacimiento | `user_account` sin esos campos | Pedido + LOPDP art. 10 (minimización) |
| Foto opcional, máximo 256 KB | `CHECK` sobre `avatar` | Pedido; límite propuesto |
| Contraseña con Argon2id | `password_hash` | OWASP; documento ESTRELLA |
| Tokens guardados solo como hash | `token_hash`, `refresh_token_hash` | Buena práctica OWASP |
| Consentimiento por finalidad, versionado y revocable | `consent_record` | LOPDP art. 8 |
| Borrado real en cascada | `ON DELETE CASCADE` más borrado del almacén | LOPDP art. 15; T-10 |
| Versiones para no pisar trabajo entre dispositivos | `current_version`, `UNIQUE(project_id, version)` | Pedido: "nunca se pierda nada" |
| Agradecimiento una vez por programa | `PROGRAM_STATE` | Pedido |
| Cuota por usuario | `storage_quota_bytes` (25 MiB por defecto) y `storage_used_bytes <= storage_quota_bytes` | Límites de plan gratuito (Neon: 0,5 GB) |
| Solo texto cifrado en el servidor | `encrypted_name` (29 a 2048 bytes) y `project_blob.data`: nonce de 12 bytes, cifrado AES-GCM y etiqueta | T-09; el contenido se cifra en el equipo |
| No pisar trabajo entre equipos | `If-Match` con la versión de partida; si no coincide, 412 y el equipo guarda una copia | RFC 9110; T-08 |
| Últimas 5 versiones por proyecto | Las anteriores se borran al subir una nueva, o antes si falta espacio | Cuota |
| Los bytes se borran con su versión | `project_blob.storage_key` → `project_version.storage_key` con `ON DELETE CASCADE` | LOPDP art. 15; T-10 |
| Retirar la nube borra la copia del servidor | Al revocar `PROJECT_SYNC` se borran los proyectos y cambia `sync_epoch` | LOPDP art. 15.6 |
| Época de sincronización | `sync_epoch` cambia cuando el servidor vacía la nube; los equipos vuelven a subir en vez de borrar | Evita perder trabajo local |
| Contenido atado a su dueño, proyecto y versión | Datos asociados de AES-GCM: `estrella:v1:content:<usuario>:<proyecto>:<versión>` | El servidor no puede intercambiar ni retroceder versiones |
| Asistente solo para mayores de edad, con su propio consentimiento | `consent_record.purpose = 'AI_ASSISTANT'`, que se da solo al conectar declarando 18 años o más | Términos de OpenRouter §2; LOPDP arts. 8 y 60 |
| La llave de OpenRouter nunca sale del servidor ni queda legible en la base | `key_ciphertext` (AES-256-GCM, de 17 a 1024 bytes) con `key_nonce` de 12 bytes; clave `AI_KEY_SECRET` del entorno; datos asociados `estrella:v1:ai-key:<usuario>` | Regla del proyecto: sin llaves en el frontend; OWASP LLM02 |
| Una conexión por estudiante | `user_id` como clave primaria; conectar de nuevo reemplaza la llave | Diseño |
| Desconectar, retirar el consentimiento o borrar la cuenta borra la llave | `DELETE` explícito y `ON DELETE CASCADE` | LOPDP arts. 15 y 15.6; T-10 |
| Ni preguntas ni respuestas se guardan | No hay tabla de conversaciones; solo `last_used_at` | LOPDP art. 10 (minimización) |

## Sin base de datos

- **Catálogo de programas:** archivo de datos versionado, con su fuente; `program_id` referencia su identificador.
- **Equivalencias:** datos versionados.
- **Conversaciones con el asistente:** solo en la pantalla del estudiante mientras la tiene abierta; no se guardan en ningún lado.
- **Verificador PKCE y `state`:** en `sessionStorage` de la pestaña, solo mientras dura la conexión (máximo 10 minutos).
- **Límite de preguntas al asistente:** en memoria, por estudiante; caduca solo.
- **Autoguardado local:** IndexedDB/OPFS del dispositivo.
- **Documento de cada programa:** JSON con versión (`v: 1`) guardado dentro del proyecto, como el resto del trabajo, y validado campo por campo al abrirlo (`parseModel` en Sólido, `parseView` en BIM, `parseCatalog` en Archivo, `parseSite` en Análisis de sitio). BIM guarda el IFC hasta 30 MB; Archivo guarda solo nombres, tamaños, fechas y las marcas del estudiante, nunca los archivos.
- **Límite de intentos de login:** en memoria o caché; caduca solo.

## Claves

Se genera una clave maestra aleatoria en el dispositivo. Se guarda en el servidor envuelta dos veces: con una clave derivada de la contraseña y con el código de recuperación. El servidor nunca ve la clave sin envolver. La contraseña usada para iniciar sesión no debe coincidir con la derivación usada para cifrar; se separan con derivaciones distintas.
