package ec.estrella.api.account;

/** Purposes of processing, each consented separately (LOPDP art. 8). */
public enum Consent {
    /** Required: keep the account so the student can sign in. */
    ACCOUNT,
    /** Optional: store encrypted projects to open them on another device. */
    PROJECT_SYNC,
    /** Optional: notify by email when a new session starts. */
    SECURITY_EMAIL,
    /**
     * Optional, 18+ only: keep the student's OpenRouter key encrypted and send the questions they
     * review to OpenRouter (United States) and the model's provider.
     */
    AI_ASSISTANT
}
