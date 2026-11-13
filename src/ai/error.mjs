// A request that did not produce an answer. `fatal` errors will repeat for every page (a
// refused key, an unknown model, a command that is not installed), so the run stops asking.
// `repeatable` errors (a command line tool that exited with an error) stop the run only when
// nothing has succeeded yet, since then they are most likely a setup problem.
export class AiRequestError extends Error {
  constructor(message, { fatal = false, repeatable = false } = {}) {
    super(message);
    this.fatal = fatal;
    this.repeatable = repeatable;
  }
}
