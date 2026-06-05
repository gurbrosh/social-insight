import path from "node:path";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const absolutePath = path.join(process.cwd(), specifier.slice(2));
    const url = pathToFileURL(absolutePath + (absolutePath.endsWith(".ts") ? "" : ".ts")).href;
    return {
      url,
      shortCircuit: true,
    };
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".json")
  ) {
    const url = new URL(specifier + ".ts", context.parentURL).href;
    return {
      url,
      shortCircuit: true,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}
