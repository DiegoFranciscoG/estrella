package ec.estrella.api.mail;

/** Delivers one plain-text email. Chosen with APP_MAIL_PROVIDER (smtp or brevo). */
public interface MailTransport {

    /**
     * @throws MailDeliveryException when the message could not be handed over; its message never
     *                               contains addresses, subjects or bodies
     */
    void send(String to, String subject, String text);
}
