// Structured logging for the server plane (GM-R19 ops posture — see
// app/docs/ops.md). One JSON object per line: machine fields, not prose, so
// the dev-tier stdout stream and a hosted log pipeline (Workers Logs class,
// saas-stratum `[observability]`) ingest the same shape.
//
// The privacy line is structural: callers log identifiers and outcomes only —
// never tokens, passwords, message bodies, mail bodies, or typed command
// lines (a typed line can carry a password mid-registration).

export type LogFields = Record<string, string | number | boolean>;

export type Logger = (event: string, fields?: LogFields) => void;

/** A logger that drops everything — the default under tests, where the
 *  fixture servers would otherwise write noise into the test runner's out. */
export const silentLogger: Logger = () => {};

/** JSON-lines to a sink (stdout by default). `ts` is ISO-8601; `event` is a
 *  dot-scoped name (`session.join`, `command.error`). */
export function jsonLineLogger(
  write: (line: string) => void = (line) => process.stdout.write(line),
): Logger {
  return (event, fields = {}) => {
    write(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n");
  };
}
