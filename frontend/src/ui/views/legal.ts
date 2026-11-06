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
    h("p", {}, h("a", { href: contact.repository, target: "_blank", rel: "noopener noreferrer" }, "Código fuente de ESTRELLA")),
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "En ESTRELLA"), h("th", {}, "Basado en"), h("th", {}, "Licencia"), h("th", {}, "Origen"), h("th", {}, "Estado"))),
        h("tbody", {}, ...rows),
      ),
    ),
    h("p", { class: "muted" }, "Los nombres de programas de pago se mencionan solo para explicar equivalencias. Pertenecen a sus dueños y ESTRELLA no tiene relación con ellos."),
  );
}

export function privacyView(): HTMLElement {
  return h("main", { class: "narrow prose", id: "main" },
    h("h1", {}, "Aviso de privacidad"),
    h("p", { class: "notice" }, "Versión 2026-11-05. Borrador: falta completar los datos de contacto del responsable antes de abrir registros públicos."),
    h("h2", {}, "Qué guardamos"),
    h("ul", {},
      h("li", {}, "Tu correo, para que tengas una cuenta."),
      h("li", {}, "Una llave derivada de tu contraseña. Tu contraseña nunca sale de tu equipo."),
      h("li", {}, "Tu foto de perfil, solo si decides subirla."),
      h("li", {}, "Tus proyectos sincronizados, cifrados en tu equipo: no podemos leerlos."),
      h("li", {}, "Tus sesiones activas y qué consentimientos diste."),
    ),
    h("h2", {}, "Qué no guardamos"),
    h("p", {}, "Teléfono, cédula, fecha de nacimiento, ubicación, historial de navegación. No hay publicidad ni rastreadores."),
    h("h2", {}, "Para qué y por cuánto tiempo"),
    h("ul", {},
      h("li", {}, "Cuenta: mientras la tengas. Las cuentas sin confirmar se borran a los 7 días."),
      h("li", {}, "Sesiones: 30 días como máximo."),
      h("li", {}, "Enlaces enviados por correo: vencen en 24 horas y se borran al día siguiente."),
    ),
    h("h2", {}, "Tus derechos"),
    h("p", {}, "Desde Mi cuenta puedes ver tus datos y borrar tu cuenta, sin escribirle a nadie. El borrado es real e inmediato. La exportación de todos tus datos en un archivo llegará junto con la sincronización de proyectos. Puedes retirar cada consentimiento opcional cuando quieras."),
    h("h2", {}, "Dónde están los servidores"),
    h("p", {}, "Los servidores de la versión publicada pueden estar fuera de Ecuador. Esta sección se completará con el proveedor exacto antes de publicar."),
    h("h2", {}, "Menores de edad"),
    h("p", {}, "Desde los 15 años puedes dar tu consentimiento. Si eres menor, tu representante legal debe acompañarte."),
    h("h2", {}, "Contacto"),
    h("p", {}, "Instagram ", h("a", { href: contact.instagram.url, target: "_blank", rel: "noopener noreferrer" }, contact.instagram.handle), "."),
  );
}
