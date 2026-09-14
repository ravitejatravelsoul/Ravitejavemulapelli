export async function resolve(specifier, context, nextResolve) {
  if (specifier === "playwright" || specifier === "playwright-core") {
    const err = new Error(`Cannot find package '${specifier}' (blocked by test loader)`);
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  }
  return nextResolve(specifier, context);
}
