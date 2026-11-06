package ec.estrella.api.mail;

import ec.estrella.api.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class SmtpMailService implements MailService {

    private static final Logger log = LoggerFactory.getLogger(SmtpMailService.class);
    private static final String SIGNATURE = "\n\nESTRELLA: programas libres para estudiantes.\n"
            + "Si no reconoces este mensaje, ignóralo. Nadie de ESTRELLA te pedirá tu contraseña.";

    private final JavaMailSender sender;
    private final AppProperties properties;

    public SmtpMailService(JavaMailSender sender, AppProperties properties) {
        this.sender = sender;
        this.properties = properties;
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

    private void send(String to, String subject, String body) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(properties.mailFrom());
        message.setTo(to);
        message.setSubject(subject);
        message.setText(body + SIGNATURE);
        try {
            sender.send(message);
        } catch (MailException e) {
            // The address is personal data: only the failure type is logged.
            log.warn("Email delivery failed: {}", e.getClass().getSimpleName());
        }
    }
}
