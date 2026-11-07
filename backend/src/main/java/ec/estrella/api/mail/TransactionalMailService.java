package ec.estrella.api.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Writes each transactional email; the configured {@link MailTransport} delivers it. */
@Service
public class TransactionalMailService implements MailService {

    private static final Logger log = LoggerFactory.getLogger(TransactionalMailService.class);
    static final String SIGNATURE = "\n\nESTRELLA: programas libres para estudiantes.\n"
            + "Si no reconoces este mensaje, ignóralo. Nadie de ESTRELLA te pedirá tu contraseña.";

    private final MailTransport transport;

    public TransactionalMailService(MailTransport transport) {
        this.transport = transport;
    }

    @Override
    public void sendVerification(String to, String link) {
        send(to, "Confirma tu correo en ESTRELLA",
                "Para activar tu cuenta abre este enlace. Vence en 24 horas.\n\n" + link);
    }

    @Override
    public void sendAlreadyRegistered(String to, String loginLink) {
        send(to, "Intento de registro con tu correo",
                "Alguien intentó crear una cuenta con este correo, pero ya tienes una.\n"
                        + "Si fuiste tú, inicia sesión aquí:\n\n" + loginLink);
    }

    @Override
    public void sendNewSession(String to, String device) {
        send(to, "Nuevo inicio de sesión en ESTRELLA",
                "Se inició sesión en tu cuenta desde: " + device + ".\n"
                        + "Si no fuiste tú, cambia tu contraseña de inmediato.");
    }

    @Override
    public void sendPasswordReset(String to, String link) {
        send(to, "Restablecer tu contraseña de ESTRELLA",
                "Para elegir una contraseña nueva abre este enlace. Vence en 24 horas.\n"
                        + "Necesitarás tu código de recuperación para conservar tus proyectos cifrados.\n\n" + link);
    }

    @Override
    public void sendAccountDeleted(String to) {
        send(to, "Tu cuenta de ESTRELLA fue eliminada",
                "Tu cuenta y todos sus datos se borraron de nuestros servidores.");
    }

    /** A failed delivery never breaks the request: answers must not reveal whether an email was due. */
    private void send(String to, String subject, String body) {
        try {
            transport.send(to, subject, body + SIGNATURE);
        } catch (MailDeliveryException e) {
            // The address is personal data: only the reason is logged.
            log.warn("Email delivery failed: {}", e.getMessage());
        }
    }
}
