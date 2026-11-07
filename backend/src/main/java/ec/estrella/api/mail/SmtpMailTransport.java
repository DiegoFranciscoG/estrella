package ec.estrella.api.mail;

import ec.estrella.api.config.AppProperties;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

/** SMTP, as in the local stack (Mailpit). Hosts that block SMTP ports use {@link BrevoMailTransport}. */
@Component
@ConditionalOnProperty(name = "app.mail-provider", havingValue = "smtp", matchIfMissing = true)
class SmtpMailTransport implements MailTransport {

    private final JavaMailSender sender;
    private final String from;

    @Autowired
    SmtpMailTransport(JavaMailSender sender, AppProperties properties, @Value("${spring.mail.host:}") String host) {
        this(sender, properties.mailFrom(), host);
    }

    SmtpMailTransport(JavaMailSender sender, String from, String host) {
        if (host == null || host.isBlank()) {
            throw new IllegalStateException("MAIL_HOST is required when APP_MAIL_PROVIDER=smtp");
        }
        this.sender = sender;
        this.from = from;
    }

    /** Text and HTML as alternatives of one message: each client shows the one it can. */
    @Override
    public void send(String to, String subject, String text, String html) {
        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
            helper.setFrom(from);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(text, html);
            sender.send(message);
        } catch (MailException | MessagingException e) {
            throw new MailDeliveryException(e.getClass().getSimpleName());
        }
    }
}
