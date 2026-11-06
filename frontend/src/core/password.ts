/** Client-side password rules (the server only ever sees a derived key, so it cannot check them). */

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 128;

// The most common choices; a long password list would weigh more than the whole panel.
const COMMON = new Set([
  "1234567890", "12345678910", "0123456789", "contraseña", "contrasena1", "password12", "password123",
  "qwertyuiop", "1q2w3e4r5t", "abcdefghij", "iloveyou12", "estrella123", "ecuador123", "1111111111",
  "aaaaaaaaaa", "contraseña1", "teamo12345", "123456789a", "qwerty1234", "asdfghjkl1",
]);

export function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  const length = [...password].length;
  if (length < MIN_LENGTH) problems.push(`Usa al menos ${MIN_LENGTH} caracteres`);
  if (length > MAX_LENGTH) problems.push(`Usa como máximo ${MAX_LENGTH} caracteres`);
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push("Es una contraseña muy común");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) problems.push("No incluyas tu correo en la contraseña");
  if (length >= MIN_LENGTH && new Set(lower).size <= 2) problems.push("Repite demasiado los mismos caracteres");
  return problems;
}
