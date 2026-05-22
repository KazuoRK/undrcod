/**
 * Pure útil — gera unified-diff patch string pra UM ÚNICO hunk.
 * Adequado pra `git apply` (ou `git apply -R` pra reverter).
 *
 * IMPORTANT: filePath deve ser relativo ao cwd (workspace root) e usar
 * forward slashes. O parser em main/ipc/git.ts já produz paths nesse
 * formato, então a normalização aqui é defensiva (backslash → slash).
 *
 * Formato gerado:
 *   diff --git a/<p> b/<p>
 *   --- a/<p>
 *   +++ b/<p>
 *   <hunk.header>
 *   <hunk.lines...>
 *   (trailing newline)
 */

export interface PatchHunkInput {
  /** Linha "@@ -A,B +C,D @@ optional context" exatamente como veio do git */
  header: string;
  /** Linhas do hunk com prefix type. '\\' = "\ No newline at end of file" marker.
   *  text NÃO inclui o prefix character. */
  lines: Array<{ type: '+' | '-' | ' ' | '\\'; text: string }>;
}

export function hunkToPatch(filePath: string, hunk: PatchHunkInput): string {
  const p = filePath.replace(/\\/g, '/');
  const lines: string[] = [
    `diff --git a/${p} b/${p}`,
    `--- a/${p}`,
    `+++ b/${p}`,
    hunk.header,
  ];
  for (const l of hunk.lines) {
    // '\\' marker: emite com prefix barra-invertida ("\ No newline at end of file").
    // Necessário pra git apply reconhecer arquivos sem newline final.
    lines.push(l.type + l.text);
  }
  return lines.join('\n') + '\n';
}
