package ec.estrella.api.mail;

/** Delivers one email in plain text and HTML. Chosen with APP_MAIL_PROVIDER (smtp or brevo). */
public interface MailTransport {

    /**
     * @param html the same content as {@code text}, already escaped and safe to send as is
     * @throws MailDeliveryException when the message could not be handed over; its message never
     *                               contains addresses, subjects or bodies
     */
    void send(String to, String subject, String text, String html);
}
