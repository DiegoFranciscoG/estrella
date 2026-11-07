package ec.estrella.api.mail;

import java.util.List;
import org.springframework.web.util.HtmlUtils;

/**
 * The HTML version of a transactional email: ESTRELLA's black-and-white look, one button for the
 * action. Built only from escaped text and the action link the server made, so nothing that
 * reached an email from elsewhere can become markup or a link. Inline styles and a table layout,
 * because that is what email clients render reliably.
 */
final class MailHtml {

    /** What the email asks the student to do, if anything: a button and the same link in plain sight. */
    record Action(String label, String url) {
    }

    private MailHtml() {
    }

    static String page(String title, List<String> paragraphs, Action action, List<String> footer) {
        StringBuilder body = new StringBuilder();
        for (String paragraph : paragraphs) {
            body.append("<p style=\"margin:0 0 16px\">").append(escapeLines(paragraph)).append("</p>");
        }
        if (action != null) {
            String url = escape(action.url());
            body.append("<p style=\"margin:24px 0\"><a href=\"").append(url)
                    .append("\" style=\"display:inline-block;background:#111111;color:#ffffff;text-decoration:none;")
                    .append("padding:12px 22px;border-radius:8px;font-weight:bold\">")
                    .append(escape(action.label())).append("</a></p>")
                    .append("<p style=\"margin:0 0 16px;font-size:13px;color:#555555;word-break:break-all\">")
                    .append("Si el botón no funciona, copia esta dirección en tu navegador:<br>").append(url).append("</p>");
        }
        StringBuilder foot = new StringBuilder();
        for (String line : footer) {
            foot.append("<p style=\"margin:0 0 6px\">").append(escapeLines(line)).append("</p>");
        }
        return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" "
                + "content=\"width=device-width\"><title>" + escape(title) + "</title></head>"
                + "<body style=\"margin:0;padding:0;background:#f2f2f2\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                + "style=\"background:#f2f2f2;padding:24px 12px\"><tr><td align=\"center\">"
                + "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;"
                + "background:#ffffff;border:1px solid #dddddd;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:#111111\">"
                + "<tr><td style=\"padding:20px 28px;border-bottom:1px solid #eeeeee;font-size:15px;font-weight:bold;"
                + "letter-spacing:4px\">&#9733; ESTRELLA</td></tr>"
                + "<tr><td style=\"padding:24px 28px 8px;font-size:16px;line-height:1.5\">"
                + "<h1 style=\"margin:0 0 16px;font-size:20px\">" + escape(title) + "</h1>" + body + "</td></tr>"
                + "<tr><td style=\"padding:16px 28px 20px;border-top:1px solid #eeeeee;font-size:12px;line-height:1.5;"
                + "color:#555555\">" + foot + "</td></tr>"
                + "</table></td></tr></table></body></html>";
    }

    private static String escapeLines(String text) {
        return escape(text).replace("\n", "<br>");
    }

    /** Only the characters that mean something in HTML; the message is UTF-8, so letters stay as they are. */
    private static String escape(String text) {
        return HtmlUtils.htmlEscape(text, "UTF-8");
    }
}
