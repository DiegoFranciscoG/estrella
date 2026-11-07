package ec.estrella.api.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sun.net.httpserver.HttpServer;
import ec.estrella.api.mail.MailHtml.Action;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** What each email says, and how it leaves: SMTP locally, Brevo's HTTPS API on hosts without SMTP. */
class MailTransportTest {

    private static final String SITE = "https://estrella-panel.netlify.app";

    private HttpServer brevo;
    private final AtomicInteger answer = new AtomicInteger(201);
    private final AtomicReference<String> apiKey = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();
    private final AtomicReference<String> path = new AtomicReference<>();

    @BeforeEach
    void startFakeBrevo() throws IOException {
        brevo = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        brevo.createContext("/", exchange -> {
            path.set(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            apiKey.set(exchange.getRequestHeaders().getFirst("api-key"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] reply = "{\"messageId\":\"<1@relay>\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(answer.get(), reply.length);
            exchange.getResponseBody().write(reply);
            exchange.close();
        });
        brevo.start();
    }

    @AfterEach
    void stopFakeBrevo() {
        brevo.stop(0);
    }

    private BrevoMailTransport brevoTransport() {
        return new BrevoMailTransport("http://127.0.0.1:" + brevo.getAddress().getPort() + "/v3", "xkeysib-prueba",
                "no-reply@example.com");
    }

    private record Sent(String to, String subject, String text, String html) {
    }

    @Test
    void brevoReceivesTheMessageAsItsApiExpects() {
        brevoTransport().send("estudiante@example.com", "Confirma tu correo en ESTRELLA", "Abre:\n\n" + SITE, "<p>Abre</p>");

        assertThat(path.get()).isEqualTo("POST /v3/smtp/email");
        assertThat(apiKey.get()).isEqualTo("xkeysib-prueba");
        JsonNode sent = JsonMapper.builder().build().readTree(body.get());
        assertThat(sent.at("/sender/email").asString()).isEqualTo("no-reply@example.com");
        assertThat(sent.at("/to/0/email").asString()).isEqualTo("estudiante@example.com");
        assertThat(sent.at("/subject").asString()).isEqualTo("Confirma tu correo en ESTRELLA");
        assertThat(sent.at("/textContent").asString()).isEqualTo("Abre:\n\n" + SITE);
        assertThat(sent.at("/htmlContent").asString()).isEqualTo("<p>Abre</p>");
    }

    @Test
    void theHtmlVersionEscapesEverythingAndLinksOnlyToTheAction() {
        String html = MailHtml.page("Asunto <b>",
                List.of("Desde: <script>alert(1)</script>\nVisita https://evil.example/x"),
                new Action("Confirmar mi correo", SITE + "/#/verificar?token=abc&x=1"),
                List.of("Pie & firma"));
        assertThat(html)
                .contains("<title>Asunto &lt;b&gt;</title>")
                .contains("Desde: &lt;script&gt;alert(1)&lt;/script&gt;<br>Visita https://evil.example/x")
                .contains("href=\"" + SITE + "/#/verificar?token=abc&amp;x=1\"")
                .contains(">Confirmar mi correo</a>")
                .contains("Pie &amp; firma")
                .doesNotContain("<script>")
                .doesNotContain("href=\"https://evil.example");
        assertThat(html.split("<a ", -1)).hasSize(2);
    }

    @Test
    void aRefusalFromBrevoIsReportedWithoutPersonalData() {
        answer.set(401);
        assertThatThrownBy(() -> brevoTransport().send("estudiante@example.com", "Asunto", "Texto", "<p>Texto</p>"))
                .isInstanceOf(MailDeliveryException.class)
                .hasMessage("Brevo answered HTTP 401")
                .hasMessageNotContaining("estudiante");
    }

    @Test
    void eachTransportRefusesToStartWithoutItsSettings() {
        assertThatThrownBy(() -> new BrevoMailTransport("https://api.brevo.com/v3", " ", "no-reply@example.com"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("BREVO_API_KEY");
        assertThatThrownBy(() -> new SmtpMailTransport(mock(JavaMailSender.class), "no-reply@example.com", ""))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("MAIL_HOST");
    }

    @Test
    void smtpSendsTextAndHtmlAsAlternativesOfOneMessage() throws Exception {
        JavaMailSender sender = mock(JavaMailSender.class);
        when(sender.createMimeMessage()).thenReturn(new MimeMessage((Session) null));
        new SmtpMailTransport(sender, "no-reply@example.com", "smtp.example.com")
                .send("estudiante@example.com", "Confirma tu correo", "Texto plano", "<p>HTML</p>");

        ArgumentCaptor<MimeMessage> captor = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(captor.capture());
        ByteArrayOutputStream raw = new ByteArrayOutputStream();
        captor.getValue().writeTo(raw);
        assertThat(raw.toString(StandardCharsets.UTF_8))
                .contains("multipart/alternative")
                .contains("text/plain")
                .contains("text/html")
                .contains("Texto plano")
                .contains("<p>HTML</p>");
    }

    @Test
    void anSmtpFailureBecomesADeliveryFailure() {
        JavaMailSender sender = mock(JavaMailSender.class);
        when(sender.createMimeMessage()).thenReturn(new MimeMessage((Session) null));
        doThrow(new MailSendException("connection refused to estudiante@example.com")).when(sender).send(any(MimeMessage.class));
        SmtpMailTransport smtp = new SmtpMailTransport(sender, "no-reply@example.com", "smtp.example.com");
        assertThatThrownBy(() -> smtp.send("estudiante@example.com", "Asunto", "Texto", "<p>Texto</p>"))
                .isInstanceOf(MailDeliveryException.class)
                .hasMessage("MailSendException");
    }

    @Test
    void emailsCarryTheirActionAndSignatureAndAFailedDeliveryNeverBreaksTheRequest() {
        List<Sent> sent = new ArrayList<>();
        MailService mail = new TransactionalMailService((to, subject, text, html) -> sent.add(new Sent(to, subject, text, html)));
        mail.sendVerification("estudiante@example.com", SITE + "/#/verificar?token=abc");
        mail.sendPasswordReset("estudiante@example.com", SITE + "/#/restablecer?token=def");
        mail.sendNewSession("estudiante@example.com", "Chrome en <Windows>");
        mail.sendAlreadyRegistered("estudiante@example.com", SITE + "/#/ingresar");
        mail.sendAccountDeleted("estudiante@example.com");

        assertThat(sent).hasSize(5);
        assertThat(sent.get(0).text()).contains(SITE + "/#/verificar?token=abc").endsWith(TransactionalMailService.SIGNATURE);
        assertThat(sent.get(0).html()).contains("href=\"" + SITE + "/#/verificar?token=abc\"").contains("Confirmar mi correo");
        assertThat(sent.get(1).text()).contains("código de recuperación");
        assertThat(sent.get(1).html()).contains("Elegir contraseña nueva");
        assertThat(sent.get(2).html()).contains("Chrome en &lt;Windows&gt;").doesNotContain("<a ");
        assertThat(sent.get(3).html()).contains("Entrar a ESTRELLA");

        MailService failing = new TransactionalMailService((to, subject, text, html) -> {
            throw new MailDeliveryException("Brevo answered HTTP 503");
        });
        assertThatCode(() -> failing.sendVerification("estudiante@example.com", SITE)).doesNotThrowAnyException();
    }
}
