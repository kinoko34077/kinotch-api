export class ProviderError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
  }
}
