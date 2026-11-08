import contact from "../../data/contacto.json";
import { api } from "../../core/api";
import { Program } from "../../core/catalog";
import { currentUser } from "../../core/session";
import { safeStorage } from "../../core/storage";
import { h } from "../dom";
import { starIcon } from "../star";

/** The contact email is configured in data/contacto.json; until it is set, only Instagram is shown. */
function emailPart(): HTMLElement | null {
  const email: string | null = contact.email;
  return email ? h("span", {}, " o al correo ", h("a", { href: `mailto:${email}` }, email)) : null;
}

function localKey(userId: string): string {
  return `estrella:thanks:${userId}`;
}

function seenLocally(userId: string): string[] {
  try {
    const v = JSON.parse(safeStorage.get(localKey(userId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(userId: string, programId: string, guest: boolean): void {
  const seen = new Set(seenLocally(userId));
  seen.add(programId);
  safeStorage.set(localKey(userId), JSON.stringify([...seen]));
  if (!guest) void api(`/me/thanks/${programId}`, { method: "PUT", auth: true }).catch(() => undefined);
}

/**
 * Thank-you note, once per program per account. It is a side panel, not a modal: it never blocks
 * the program, and it does not steal focus from work in progress.
 */
export function maybeShowThanks(program: Program, container: HTMLElement): void {
  const user = currentUser();
  if (!user) return;
  if (seenLocally(user.id).includes(program.id)) return;

  const show = () => {
    const close = h("button", { type: "button", class: "ghost", "data-testid": "thanks-close" }, "Cerrar");
    const aside = h("aside", { class: "thanks", "aria-labelledby": "thanks-title", "data-testid": "thanks" },
      h("div", { class: "thanks-head" }, starIcon(20), h("h2", { id: "thanks-title" }, `Gracias por usar ${program.name}`)),
      h("p", {}, "ESTRELLA es libre y gratuito. Si te sirve, puedes apoyarlo así:"),
      h("ul", {},
        h("li", {}, "Dale una estrella al ", h("a", { href: contact.repository, target: "_blank", rel: "noopener noreferrer" }, "repositorio"), "."),
        h("li", {}, "Compártelo con tus compañeros."),
        h("li", {}, "¿Falta un programa o algo falla? Escríbeme por Instagram ",
          h("a", { href: contact.instagram.url, target: "_blank", rel: "noopener noreferrer" }, contact.instagram.handle),
          ", por ", h("a", { href: contact.linkedin.url, target: "_blank", rel: "noopener noreferrer" }, "LinkedIn"),
          emailPart(),
          "."),
        contact.donations.enabled && contact.donations.url
          ? h("li", {}, h("a", { href: contact.donations.url, target: "_blank", rel: "noopener noreferrer" }, contact.donations.label ?? "Apoyar con una donación"))
          : null,
      ),
      close,
    );
    close.addEventListener("click", () => aside.remove());
    container.appendChild(aside);
    remember(user.id, program.id, user.guest === true);
  };

  if (user.offline) {
    show();
    return;
  }
  void api<{ programs: string[] }>("/me/thanks", { auth: true })
    .then((r) => {
      if (r.programs.includes(program.id)) {
        const seen = new Set(seenLocally(user.id));
        seen.add(program.id);
        safeStorage.set(localKey(user.id), JSON.stringify([...seen]));
      } else show();
    })
    .catch(show);
}
