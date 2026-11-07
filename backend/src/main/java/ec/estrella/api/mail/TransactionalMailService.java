package ec.estrella.api.mail;

import ec.estrella.api.mail.MailHtml.Action;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Writes each transactional email, in plain text and in HTML with one button for its action; the
 * configured {@link MailTransport} delivers it.
 */
@Service
public class TransactionalMailService implements MailService {

    private static final Logger log = LoggerFactory.getLogger(TransactionalMailService.class);
    private static final List<String> FOOTER = List.of(
            "ESTRELLA: programas libres para estudiantes.",
            "Si no reconoces este mensaje, ignóralo. Nadie de ESTRELLA te pedirá tu contraseña.");
    static final String SIGNATURE = "\n\n" + String.join("\n", FOOTER);

    private final MailTransport transport;

    public TransactionalMailService(MailTransport transport) {
        this.transport = transport;
    }

    @Override
    public void sendVerification(String to, String link) {
        send(to, "Confirma tu correo en ESTRELLA",
                List.of("Para activar tu cuenta abre este enlace. Vence en 24 horas."),
                new Action("Confirmar mi correo", link));
    }

    @Override
    public void sendAlreadyRegistered(String to, String loginLink) {
        send(to, "Intento de registro con tu correo",
                List.of("Alguien intentó crear una cuenta con este correo, pero ya tienes una.",
                        "Si fuiste tú, inicia sesión aquí:"),
                new Action("Entrar a ESTRELLA", loginLink));
    }

    @Override
    public void sendNewSession(String to, String device) {
        send(to, "Nuevo inicio de sesión en ESTRELLA",
                List.of("Se inició sesión en tu cuenta desde: " + device + ".",
                        "Si no fuiste tú, cambia tu contraseña de inmediato."),
                null);
    }

    @Override
    public void sendPasswordReset(String to, String link) {
        send(to, "Restablecer tu contraseña de ESTRELLA",
                List.of("Para elegir una contraseña nueva abre este enlace. Vence en 24 horas.",
                        "Necesitarás tu código de recuperación para conservar tus proyectos cifrados."),
                new Action("Elegir contraseña nueva", link));
    }

    @Override
    public void sendAccountDeleted(String to) {
        send(to, "Tu cuenta de ESTRELLA fue eliminada",
                List.of("Tu cuenta y todos sus datos se borraron de nuestros servidores."),
                null);
    }

    /** A failed delivery never breaks the request: answers must not reveal whether an email was due. */
    private void send(String to, String subject, List<String> paragraphs, Action action) {
        String text = String.join("\n", paragraphs) + (action == null ? "" : "\n\n" + action.url()) + SIGNATURE;
        String html = MailHtml.page(subject, paragraphs, action, FOOTER);
        try {
            transport.send(to, subject, text, html);
        } catch (MailDeliveryException e) {
            // The address is personal data: only the reason is logged.
            log.warn("Email delivery failed: {}", e.getMessage());
        }
    }
}
