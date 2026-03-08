/**
 * CLI response validation utilities.
 *
 * Betaflight CLI returns error text in the response when a command is rejected.
 * These helpers detect CLI error patterns so callers can abort on failure
 * instead of silently continuing with partially applied settings.
 */

/**
 * Substring error patterns — these are specific enough to not produce
 * false positives when they appear inside setting values.
 */
const CLI_ERROR_SUBSTRINGS = [
  'Invalid name',
  'Invalid value',
  'Unknown command',
  'Parse error',
] as const;

/**
 * Line-level error pattern — "ERROR" alone could appear as a substring
 * in setting values (e.g., "NO_ERROR"), so we match it only when it
 * appears as a standalone line (after stripping whitespace).
 */
const CLI_ERROR_LINE_REGEX = /^\s*ERROR\s*$/m;

export class CLICommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly response: string,
    public readonly matchedPattern: string
  ) {
    super(`CLI command rejected: "${command}" — ${matchedPattern}`);
    this.name = 'CLICommandError';
  }
}

/**
 * Check a CLI response for error patterns.
 *
 * Betaflight CLI echoes the command, then prints result lines, then the `# ` prompt.
 * Error responses contain one of the known patterns (e.g., "Invalid name\r\n").
 *
 * @param command - The CLI command that was sent (for error context)
 * @param response - The raw response text from sendCLICommand()
 * @throws CLICommandError if the response contains a known error pattern
 */
export function validateCLIResponse(command: string, response: string): void {
  for (const pattern of CLI_ERROR_SUBSTRINGS) {
    if (response.includes(pattern)) {
      throw new CLICommandError(command, response, pattern);
    }
  }
  if (CLI_ERROR_LINE_REGEX.test(response)) {
    throw new CLICommandError(command, response, 'ERROR');
  }
}
