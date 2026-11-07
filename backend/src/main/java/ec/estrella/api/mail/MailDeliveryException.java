package ec.estrella.api.mail;

/** An email could not be delivered. The message is a short reason, safe to log. */
public class MailDeliveryException extends RuntimeException {

    public MailDeliveryException(String reason) {
        super(reason, null, false, false);
    }
}
