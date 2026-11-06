package ec.estrella.api.mail;

/** Transactional emails. Implementations must never log addresses, links or tokens. */
public interface MailService {

    void sendVerification(String to, String link);

    void sendAlreadyRegistered(String to, String loginLink);

    void sendNewSession(String to, String device);

    void sendPasswordReset(String to, String link);

    void sendAccountDeleted(String to);
}
