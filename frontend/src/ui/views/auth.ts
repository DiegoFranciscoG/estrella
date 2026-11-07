import { api, ApiError } from "../../core/api";
import { DEV_MAILBOX } from "../../core/config";
import { passwordProblems } from "../../core/password";
import { completeReset, Consent, login, register } from "../../core/session";
import { announce, h } from "../dom";
import { liteActive } from "../shell";
import { starIcon, starSpinner } from "../star";

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Ocurrió un error inesperado";
}

function field(label: string, input: HTMLInputElement, hint?: string): HTMLElement {
  const hintId = hint ? `${input.id}-hint` : undefined;
  if (hintId) input.setAttribute("aria-describedby", hintId);
  return h("div", { class: "field" }, h("label", { for: input.id }, label), input, hint ? h("p", { class: "hint", id: hintId }, hint) : null);
}

function authLayout(title: string, ...content: (Node | null)[]): HTMLElement {
  const hero = h("div", { class: "auth-hero" });
  if (!liteActive() && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    void import("../star3d").then((m) => m.mountStar3d(hero));
  } else {
    hero.appendChild(starIcon(140));
  }
  return h("main", { class: "auth", id: "main" },
    hero,
    h("section", { class: "card auth-card" },
      h("h1", {}, title),
      ...content,
    ),
  );
}

function errorBox(): HTMLElement {
  return h("p", { class: "error", role: "alert", "data-testid": "error" });
}

/** Local stack only: its emails never reach real inboxes, they wait in the test mailbox. */
function devMailboxNote(): HTMLElement | null {
  if (!DEV_MAILBOX) return null;
  return h("p", { class: "notice", "data-testid": "dev-mailbox" },
    "Entorno local: los correos no salen a internet. Ábrelos en el ",
    h("a", { href: DEV_MAILBOX, target: "_blank", rel: "noopener noreferrer" }, "buzón de pruebas"), ".");
}

async function busy(button: HTMLButtonElement, label: string, work: () => Promise<void>): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  button.replaceChildren(starSpinner(label), document.createTextNode(` ${label}`));
  try {
    await work();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function loginView(): HTMLElement {
  const email = h("input", { id: "email", type: "email", autocomplete: "email", required: true, maxlength: 254 });
  const password = h("input", { id: "password", type: "password", autocomplete: "current-password", required: true, maxlength: 128 });
  const error = errorBox();
  const submit = h("button", { type: "submit", class: "primary" }, "Entrar");
  const resend = h("button", { type: "button", class: "link", hidden: true }, "Enviar de nuevo el correo de confirmación");
  resend.addEventListener("click", async () => {
    await api("/auth/resend-verification", { method: "POST", body: { email: email.value } }).catch(() => undefined);
    error.textContent = "Si la cuenta existe y no está confirmada, te enviamos otro correo.";
  });
  const mailbox = devMailboxNote();
  if (mailbox) mailbox.hidden = true;
  const form = h("form", { novalidate: true }, field("Correo", email), field("Contraseña", password), error, resend, mailbox, submit);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    error.textContent = "";
    resend.hidden = true;
    if (mailbox) mailbox.hidden = true;
    if (!email.value || !password.value) {
      error.textContent = "Escribe tu correo y tu contraseña.";
      return;
    }
    void busy(submit, "Protegiendo tu contraseña", async () => {
      try {
        await login(email.value, password.value);
        announce("Sesión iniciada");
        location.hash = "#/";
      } catch (e) {
        error.textContent = errorText(e);
        if (e instanceof ApiError && e.code === "EMAIL_NOT_VERIFIED") {
          resend.hidden = false;
          if (mailbox) mailbox.hidden = false;
        }
      }
    });
  });
  return authLayout("Entrar",
    h("p", { class: "lead" }, "Programas de diseño, CAD y edición, libres y gratuitos."),
    form,
    h("p", {}, h("a", { href: "#/registro" }, "Crear una cuenta"), " · ", h("a", { href: "#/olvide" }, "Olvidé mi contraseña")),
  );
}

export function registerView(): HTMLElement {
  const email = h("input", { id: "email", type: "email", autocomplete: "email", required: true, maxlength: 254 });
  const password = h("input", { id: "password", type: "password", autocomplete: "new-password", required: true, maxlength: 128 });
  const confirm = h("input", { id: "confirm", type: "password", autocomplete: "new-password", required: true, maxlength: 128 });
  const age = h("input", { id: "age", type: "checkbox", required: true });
  const consentAccount = h("input", { id: "c-account", type: "checkbox", required: true });
  const consentSync = h("input", { id: "c-sync", type: "checkbox" });
  const consentSecurity = h("input", { id: "c-security", type: "checkbox" });
  const error = errorBox();
  const submit = h("button", { type: "submit", class: "primary" }, "Crear cuenta");

  const form = h("form", { novalidate: true },
    field("Correo", email),
    field("Contraseña", password, "Al menos 10 caracteres. Una frase larga es más segura y fácil de recordar."),
    field("Repite la contraseña", confirm),
    h("fieldset", {},
      h("legend", {}, "Tu consentimiento"),
      h("label", { class: "check" }, age, " Tengo 15 años o más. Si soy menor, mi representante legal me acompaña."),
      h("label", { class: "check" }, consentAccount, " Acepto que guarden mi correo para tener una cuenta, en servidores fuera de Ecuador (obligatorio)."),
      h("label", { class: "check" }, consentSync, " Quiero guardar mis proyectos en la nube para abrirlos en otros equipos (opcional). Se cifran en mi equipo y solo yo puedo leerlos; acepto que se guarden en servidores fuera de Ecuador."),
      h("label", { class: "check" }, consentSecurity, " Avísenme por correo cuando se inicie sesión en mi cuenta (opcional)."),
      h("p", { class: "hint" }, "Puedes retirar cada consentimiento cuando quieras. ", h("a", { href: "#/privacidad" }, "Aviso de privacidad")),
    ),
    error,
    submit,
  );

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    error.textContent = "";
    const problems = passwordProblems(password.value, email.value);
    if (!email.validity.valid || !email.value) problems.unshift("Escribe un correo válido");
    if (password.value !== confirm.value) problems.push("Las contraseñas no coinciden");
    if (!age.checked) problems.push("Confirma tu edad");
    if (!consentAccount.checked) problems.push("Sin el consentimiento obligatorio no podemos crear la cuenta");
    if (problems.length) {
      error.textContent = problems.join(". ") + ".";
      return;
    }
    const consents: Consent[] = ["ACCOUNT"];
    if (consentSync.checked) consents.push("PROJECT_SYNC");
    if (consentSecurity.checked) consents.push("SECURITY_EMAIL");
    void busy(submit, "Creando tus llaves", async () => {
      try {
        const code = await register(email.value, password.value, consents);
        document.getElementById("main")?.replaceWith(recoveryCodeView(code, email.value));
      } catch (e) {
        error.textContent = errorText(e);
      }
    });
  });

  return authLayout("Crear cuenta",
    h("p", { class: "lead" }, "Solo tu correo y una contraseña. Nada más."),
    form,
    h("p", {}, "¿Ya tienes cuenta? ", h("a", { href: "#/ingresar" }, "Entrar")),
  );
}

/** Shown once: without this code a forgotten password means synced projects cannot be decrypted. */
export function recoveryCodeView(code: string, email: string, afterReset = false): HTMLElement {
  const saved = h("input", { id: "saved", type: "checkbox" });
  const next = h("button", { type: "button", class: "button primary disabled", "aria-disabled": "true", "data-testid": "continue" }, "Continuar");
  saved.addEventListener("change", () => {
    next.classList.toggle("disabled", !saved.checked);
    next.setAttribute("aria-disabled", String(!saved.checked));
  });
  next.addEventListener("click", () => {
    if (!saved.checked) {
      announce("Primero marca que guardaste tu código");
      return;
    }
    // A new account still has to be confirmed: say where the link went before asking to sign in.
    if (afterReset) location.hash = "#/ingresar";
    else document.getElementById("main")?.replaceWith(checkEmailView(email));
  });
  const download = h("button", { type: "button", class: "ghost" }, "Descargar como archivo de texto");
  download.addEventListener("click", () => {
    const blob = new Blob([`ESTRELLA - código de recuperación\nCuenta: ${email}\nCódigo: ${code}\n\nGuárdalo fuera de tu computadora. Sin él no se pueden recuperar los proyectos sincronizados si olvidas la contraseña.\n`], { type: "text/plain" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "estrella-codigo-recuperacion.txt" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  return h("main", { class: "auth single", id: "main" },
    h("section", { class: "card auth-card" },
      h("h1", {}, "Guarda tu código de recuperación"),
      h("p", {}, afterReset ? "Tu contraseña cambió. Este es tu código nuevo; el anterior ya no sirve." : "Te enviamos un correo para confirmar tu cuenta. Antes, guarda este código:"),
      h("p", { class: "code", "data-testid": "recovery-code" }, code),
      h("p", {}, "Tus proyectos se cifran en tu equipo y nadie más, ni siquiera ESTRELLA, puede leerlos. Por eso, si olvidas la contraseña, este código es la única forma de recuperarlos. Escríbelo en papel o guárdalo fuera de esta computadora."),
      download,
      h("label", { class: "check" }, saved, " Ya guardé mi código"),
      next,
    ),
  );
}

/** After signing up: the account works once the emailed link is opened. */
export function checkEmailView(email: string): HTMLElement {
  const status = h("p", { role: "status", "data-testid": "resend-status" });
  const resend = h("button", { type: "button", class: "ghost", "data-testid": "resend" }, "Enviar el correo otra vez");
  resend.addEventListener("click", () => {
    void busy(resend, "Enviando", async () => {
      await api("/auth/resend-verification", { method: "POST", body: { email } }).catch(() => undefined);
      status.textContent = "Listo. Si la cuenta aún no está confirmada, te enviamos otro enlace.";
    });
  });
  return authLayout("Revisa tu correo",
    h("p", { class: "lead" }, "Te enviamos un enlace a ", h("strong", { "data-testid": "sent-to" }, email),
      ". Ábrelo para activar tu cuenta; vence en 24 horas."),
    devMailboxNote(),
    h("ul", { class: "hint" },
      h("li", {}, "Si no aparece en unos minutos, busca en spam o en promociones."),
      h("li", {}, "Si el correo estaba mal escrito, crea la cuenta otra vez con el correcto."),
    ),
    resend,
    status,
    h("p", {}, h("a", { href: "#/ingresar" }, "Ya lo confirmé: entrar")),
  );
}

export function verifyView(token: string | null): HTMLElement {
  const status = h("p", { role: "status" }, "Confirmando tu correo...");
  const main = authLayout("Confirmar correo", status);
  if (!token) {
    // The token leaves the address once used, so reloading after confirming also lands here.
    status.replaceChildren("Si ya confirmaste tu correo, ", h("a", { href: "#/ingresar" }, "entra aquí"),
      ". Si no, abre otra vez el enlace del correo; vence en 24 horas.");
    return main;
  }
  api("/auth/verify-email", { method: "POST", body: { token } })
    .then(() => {
      status.replaceChildren("Correo confirmado. ", h("a", { href: "#/ingresar" }, "Entrar ahora"));
    })
    .catch((e) => {
      status.replaceChildren(errorText(e), " ", h("a", { href: "#/ingresar" }, "Ir a Entrar"),
        ": si tu cuenta aún no está confirmada, ahí puedes pedir un enlace nuevo.");
    });
  return main;
}

export function forgotView(): HTMLElement {
  const email = h("input", { id: "email", type: "email", autocomplete: "email", required: true, maxlength: 254 });
  const message = h("p", { role: "status" });
  const submit = h("button", { type: "submit", class: "primary" }, "Enviar enlace");
  const form = h("form", { novalidate: true }, field("Correo", email), message, submit);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void busy(submit, "Enviando", async () => {
      try {
        await api("/auth/password-reset/request", { method: "POST", body: { email: email.value } });
        message.textContent = "Si existe una cuenta con ese correo, te enviamos un enlace. Revisa tu bandeja.";
        const note = devMailboxNote();
        if (note && !form.querySelector("[data-testid=dev-mailbox]")) message.after(note);
      } catch (e) {
        message.textContent = errorText(e);
      }
    });
  });
  return authLayout("Olvidé mi contraseña", form, h("p", {}, h("a", { href: "#/ingresar" }, "Volver")));
}

export function resetView(token: string | null): HTMLElement {
  const email = h("input", { id: "email", type: "email", autocomplete: "email", required: true });
  const password = h("input", { id: "password", type: "password", autocomplete: "new-password", required: true, maxlength: 128 });
  const code = h("input", { id: "code", type: "text", autocomplete: "off", spellcheck: "false", maxlength: 40 });
  const discard = h("input", { id: "discard", type: "checkbox" });
  const error = errorBox();
  const submit = h("button", { type: "submit", class: "primary" }, "Cambiar contraseña");
  const form = h("form", { novalidate: true },
    field("Tu correo", email),
    field("Contraseña nueva", password),
    field("Código de recuperación", code, "El código de 26 caracteres que guardaste al crear la cuenta."),
    h("label", { class: "check" }, discard, " No tengo el código: acepto perder los proyectos sincronizados. Los guardados en este equipo no se tocan."),
    error,
    submit,
  );
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    error.textContent = "";
    if (!token) {
      error.textContent = "El enlace está incompleto. Ábrelo de nuevo desde tu correo.";
      return;
    }
    const problems = passwordProblems(password.value, email.value);
    if (!code.value && !discard.checked) problems.push("Escribe tu código o marca que no lo tienes");
    if (problems.length) {
      error.textContent = problems.join(". ") + ".";
      return;
    }
    void busy(submit, "Protegiendo tu contraseña", async () => {
      try {
        const newCode = await completeReset(token, email.value, password.value, discard.checked ? null : code.value);
        document.getElementById("main")?.replaceWith(recoveryCodeView(newCode, email.value, true));
      } catch (e) {
        error.textContent = errorText(e);
      }
    });
  });
  return authLayout("Elegir contraseña nueva", form);
}
