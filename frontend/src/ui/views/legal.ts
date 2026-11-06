import contact from "../../data/contacto.json";
import { programs } from "../../core/catalog";
import { h } from "../dom";

export function licensesView(): HTMLElement {
  const rows = programs.filter((p) => p.basedOn).map((p) =>
    h("tr", {},
      h("td", {}, p.name),
      h("td", {}, p.basedOn!.name),
      h("td", {}, p.basedOn!.license),
      h("td", {}, h("a", { href: p.basedOn!.source, target: "_blank", rel: "noopener noreferrer" }, "Código fuente")),
      h("td", {}, p.status === "disponible" ? "Incluido" : "Previsto"),
    ));
  return h("main", { class: "narrow", id: "main" },
    h("h1", {}, "Licencias"),
    h("p", {}, "El código de ESTRELLA usa licencia MIT. Cada programa libre que integramos conserva su propia licencia y su aviso de autor."),
    h("p", {},
      h("a", { href: contact.repository, target: "_blank", rel: "noopener noreferrer" }, "Código fuente de ESTRELLA"),
      " · ",
      h("a", { href: "/THIRD-PARTY-NOTICES.txt", target: "_blank", rel: "noopener" }, "Avisos de todas las bibliotecas incluidas"),
    ),
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "En ESTRELLA"), h("th", {}, "Basado en"), h("th", {}, "Licencia"), h("th", {}, "Origen"), h("th", {}, "Estado"))),
        h("tbody", {}, ...rows),
      ),
    ),
    h("p", { class: "muted" }, "Los nombres de programas de pago se mencionan solo para explicar equivalencias. Pertenecen a sus dueños y ESTRELLA no tiene relación con ellos."),
  );
}

/** Version of the privacy notice; consents are recorded with it (backend: app.privacy-notice-version). */
export const PRIVACY_NOTICE_VERSION = "2026-11-06";

const pending = (value: string | null) => value ?? "pendiente";

/**
 * Privacy notice. Follows the 17 points of LOPDP art. 12, in plain words, in the same order of
 * importance a student reads: what, why, for how long, who else, and how to exercise each right.
 */
export function privacyView(): HTMLElement {
  const owner = contact.responsable;
  const incomplete = !owner.domicilio || !owner.telefono || !owner.correo;
  const li = (...children: (string | HTMLElement)[]) => h("li", {}, ...children);
  return h("main", { class: "narrow prose", id: "main" },
    h("h1", {}, "Aviso de privacidad"),
    h("p", { class: "muted" }, `Versión ${PRIVACY_NOTICE_VERSION}. Ley Orgánica de Protección de Datos Personales del Ecuador (LOPDP).`),
    incomplete ? h("p", { class: "notice", "data-testid": "privacy-draft" }, "Borrador: faltan datos del responsable (domicilio, teléfono o correo). No se deben abrir registros públicos hasta completarlos.") : null,

    h("h2", {}, "Quién es el responsable"),
    h("ul", {},
      li(`Nombre: ${owner.nombre}`),
      li(`Domicilio legal: ${pending(owner.domicilio)}`),
      li(`Teléfono: ${pending(owner.telefono)}`),
      li(`Correo: ${pending(owner.correo)}`),
      li("Delegado de protección de datos: no designado; se evaluará antes de publicar si la ley lo exige."),
    ),

    h("h2", {}, "Qué datos tratamos y para qué"),
    h("ul", {},
      li(h("strong", {}, "Cuenta (obligatorio): "), "tu correo y una llave derivada de tu contraseña, para que puedas entrar. Tu contraseña nunca sale de tu equipo. También guardamos las sesiones abiertas (fechas, sin ubicación) y qué consentimientos diste y cuándo."),
      li(h("strong", {}, "Correos necesarios: "), "confirmar tu correo, recuperar tu contraseña y avisarte si borras tu cuenta."),
      li(h("strong", {}, "Foto de perfil (opcional): "), "solo si la subes."),
      li(h("strong", {}, "Nube de proyectos (opcional): "), "copias de tus proyectos para abrirlos en otros equipos. Se cifran en tu equipo antes de salir; no podemos leer ni su contenido ni sus nombres. Guardamos su tamaño, fechas y las últimas 5 versiones."),
      li(h("strong", {}, "Avisos de seguridad (opcional): "), "un correo cuando se inicia sesión en tu cuenta."),
    ),
    h("p", {}, "No pedimos teléfono, cédula, fecha de nacimiento ni ubicación. No hay publicidad, rastreadores, perfiles ni decisiones automatizadas sobre ti, y no vendemos ni cedemos datos."),
    h("p", {}, "Origen: todos los datos los das tú. Base legal: tu consentimiento, uno por finalidad (art. 8). Tratamiento: recogerlos, guardarlos en una base de datos de ESTRELLA, usarlos solo para lo descrito y borrarlos."),

    h("h2", {}, "Por cuánto tiempo"),
    h("ul", {},
      li("Cuenta, foto y nube: hasta que los borres o borres tu cuenta. Las cuentas sin confirmar se borran a los 7 días."),
      li("Sesiones: 30 días como máximo. Enlaces enviados por correo: vencen en 24 horas y se borran al día siguiente."),
      li("Versiones en la nube: las 5 más recientes de cada proyecto."),
      li("Copias de seguridad del proveedor de base de datos: pueden conservar por un tiempo limitado datos ya borrados; el plazo exacto se publicará antes de abrir registros."),
    ),

    h("h2", {}, "Quién más interviene y dónde"),
    h("p", {}, "Usamos proveedores que guardan y procesan datos por encargo nuestro: el servidor de la aplicación, la base de datos, el envío de correos y el alojamiento de la página. Sus servidores pueden estar fuera de Ecuador (por ejemplo, en Estados Unidos o la Unión Europea), lo que es una transferencia internacional. Como garantía, tus proyectos viajan y se guardan cifrados con una llave que solo tienes tú. Al activar la nube aceptas esa transferencia de forma expresa (art. 60). La lista exacta de proveedores se publicará antes de abrir registros."),

    h("h2", {}, "Si no das tus datos o están mal"),
    h("p", {}, "Sin un correo no podemos crearte una cuenta. Sin la nube, tus proyectos quedan solo en tu equipo y no los verás en otro. Si escribes mal tu correo, no podrás confirmarlo ni recuperar tu contraseña."),

    h("h2", {}, "Tus derechos y cómo ejercerlos"),
    h("ul", {},
      li(h("strong", {}, "Acceso y portabilidad: "), "en Mi cuenta, «Descargar todos mis datos» te da un ZIP con todo lo que guardamos y tus proyectos descifrados, en formatos comunes (JSON)."),
      li(h("strong", {}, "Eliminación: "), "en Mi cuenta, «Borrar mi cuenta» lo borra todo del servidor en el momento. Desactivar la nube borra la copia del servidor."),
      li(h("strong", {}, "Revocar consentimientos: "), "en Mi cuenta puedes desactivar la nube y los avisos de seguridad cuando quieras."),
      li(h("strong", {}, "Rectificación, oposición, limitación o cualquier otra solicitud: "), `escríbenos (${pending(owner.correo)}). Respondemos en un máximo de 15 días.`),
    ),
    h("p", {}, "Si crees que no respetamos tus derechos, puedes reclamarnos a nosotros y también a la ", h("a", { href: "https://www.spdp.gob.ec/", target: "_blank", rel: "noopener noreferrer" }, "Superintendencia de Protección de Datos Personales"), "."),

    h("h2", {}, "Seguridad"),
    h("p", {}, "Contraseñas que nunca llegan al servidor, cifrado de proyectos en tu equipo (AES-GCM), conexiones cifradas y borrado real en cascada. Si ocurriera una vulneración, avisaremos a la Autoridad en 5 días como máximo y a ti en 3 días cuando haya riesgo para tus derechos (arts. 43 y 46)."),

    h("h2", {}, "En tu navegador"),
    h("p", {}, "Tus proyectos se guardan en tu equipo (IndexedDB), junto con una llave de sincronización que el navegador no deja leer. Una cookie segura mantiene tu sesión. No usamos cookies de terceros."),

    h("h2", {}, "Menores de edad"),
    h("p", {}, "Desde los 15 años puedes dar tu consentimiento. Si eres menor, tu representante legal debe acompañarte y conocer este aviso."),

    h("h2", {}, "Contacto"),
    h("p", {}, `Correo: ${pending(owner.correo)}. Instagram `, h("a", { href: contact.instagram.url, target: "_blank", rel: "noopener noreferrer" }, contact.instagram.handle), "."),
  );
}
